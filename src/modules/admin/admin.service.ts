import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { ChatGateway } from '../chat/chat.gateway';
import type { GroupMember } from '../order/types/group-member';
import type { Companion } from '../order/types/companion';

const REFUNDABLE_STATUSES = ['PENDING', 'PAID'];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly chatGateway: ChatGateway,
  ) {}

  /**
   * One row per user, each carrying their full order history — the admin
   * table groups by this "主揪" identity so a person's repeated group-ticket
   * orders collapse into one expandable row instead of one row per order.
   */
  listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        team: true,
        lineId: true,
        phone: true,
        createdAt: true,
        orders: {
          select: {
            id: true,
            quantity: true,
            totalAmount: true,
            status: true,
            createdAt: true,
            mealPreference: true,
            adminNote: true,
            groupLeaderName: true,
            groupLeaderLineId: true,
            groupLeaderPhone: true,
            groupMembers: true,
            ticketType: { select: { name: true, price: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** One row per order, flattened with the owning user's email — feeds the order-management table. */
  async listOrdersFlat() {
    const orders = await this.prisma.order.findMany({
      include: {
        user: { select: { id: true, email: true } },
        ticketType: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => ({
      id: order.id,
      userId: order.user.id,
      userEmail: order.user.email,
      registrantName: order.registrantName,
      registrantTeam: order.registrantTeam,
      registrantLineId: order.registrantLineId,
      registrantPhone: order.registrantPhone,
      mealPreference: order.mealPreference,
      ticketTypeName: order.ticketType.name,
      quantity: order.quantity,
      totalAmount: order.totalAmount,
      status: order.status,
      createdAt: order.createdAt,
      adminNote: order.adminNote,
      groupLeaderName: order.groupLeaderName,
      groupLeaderLineId: order.groupLeaderLineId,
      groupLeaderPhone: order.groupLeaderPhone,
      groupMembers: order.groupMembers as GroupMember[] | null,
    }));
  }

  /**
   * Per-team ranking of ticket volume (by quantity, counting PENDING+PAID
   * orders only) with each team's share of the total — feeds the
   * order-management page's stats panel.
   */
  async getTeamStats() {
    const orders = await this.prisma.order.findMany({
      where: { status: { in: REFUNDABLE_STATUSES as any } },
      select: { registrantTeam: true, quantity: true },
    });

    const totals = new Map<string, number>();
    let grandTotal = 0;
    for (const order of orders) {
      totals.set(
        order.registrantTeam,
        (totals.get(order.registrantTeam) ?? 0) + order.quantity,
      );
      grandTotal += order.quantity;
    }

    return Array.from(totals.entries())
      .map(([team, ticketCount]) => ({
        team,
        ticketCount,
        percentage: grandTotal > 0 ? (ticketCount / grandTotal) * 100 : 0,
      }))
      .sort((a, b) => b.ticketCount - a.ticketCount)
      .map((row, i) => ({ ...row, rank: i + 1 }));
  }

  async updateOrderNote(id: string, note: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return this.prisma.order.update({
      where: { id },
      data: { adminNote: note },
    });
  }

  /**
   * Releases an order's reserved stock the same way order cancellation
   * does — via the shared pool + group-cap counter when the ticket type
   * uses one, or a plain per-ticket-type release otherwise.
   */
  private async releaseOrderStock(order: {
    quantity: number;
    ticketType: {
      id: string;
      fixedQuantity: number | null;
      sharedStockKey: string | null;
      maxGroupOrders: number | null;
    };
  }) {
    const stockKey = order.ticketType.sharedStockKey ?? order.ticketType.id;
    if (
      order.ticketType.fixedQuantity !== null &&
      order.ticketType.maxGroupOrders !== null
    ) {
      await this.inventory.releaseGroupStock(
        stockKey,
        order.ticketType.id,
        order.quantity,
      );
    } else {
      await this.inventory.releaseStock(stockKey, order.quantity);
    }
  }

  /**
   * Deletes a user and all of their orders. Any order that still held stock
   * (PENDING/PAID) has that stock released back to the pool first, same as
   * a normal cancellation — otherwise those seats would be lost forever.
   */
  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { orders: { include: { ticketType: true } } },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);

    for (const order of user.orders) {
      if (REFUNDABLE_STATUSES.includes(order.status)) {
        await this.releaseOrderStock(order);
      }
    }

    await this.prisma.order.deleteMany({ where: { userId: id } });
    await this.prisma.user.delete({ where: { id } });

    return { deleted: true };
  }

  /** Same per-user cleanup as deleteUser, applied to a batch of user ids. */
  async bulkDeleteUsers(ids: string[]) {
    for (const id of ids) {
      await this.deleteUser(id);
    }
    return { deleted: ids.length };
  }

  /**
   * Deletes a single order (e.g. an admin rejecting a suspected duplicate/
   * fraudulent individual-ticket order after manual review). Releases its
   * stock back to the pool first if it still held any, same as a normal
   * cancellation.
   */
  async deleteOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: { ticketType: true },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found`);

    if (REFUNDABLE_STATUSES.includes(order.status)) {
      await this.releaseOrderStock(order);
    }
    await this.prisma.order.delete({ where: { id } });

    return { deleted: true };
  }

  /** Same per-order cleanup as deleteOrder, applied to a batch of order ids. */
  async bulkDeleteOrders(ids: string[]) {
    for (const id of ids) {
      await this.deleteOrder(id);
    }
    return { deleted: ids.length };
  }

  /**
   * Re-derives every ticket type's Redis stock counter from totalQuantity
   * minus its real PAID orders — NOT a blind reset to totalQuantity, which
   * would silently un-sell any tickets already bought by real customers.
   * Meant to repair drift (e.g. after a load test), not to "restock" tickets.
   *
   * Ticket types that share a stock pool (sharedStockKey set) are resynced
   * together: the pool is set to poolTotalQuantity minus PAID orders summed
   * across every ticket type in the pool, and any pooled ticket type with a
   * group-bundle cap (maxGroupOrders) also gets its bundle counter resynced
   * from a real count of its own PAID orders (each one bundle).
   */
  async resetStock() {
    const ticketTypes = await this.prisma.ticketType.findMany({
      select: {
        id: true,
        name: true,
        totalQuantity: true,
        sharedStockKey: true,
        poolTotalQuantity: true,
        maxGroupOrders: true,
      },
    });

    const results: { id: string; name: string; resetTo: number }[] = [];
    const pooled = new Map<string, typeof ticketTypes>();
    const independent: typeof ticketTypes = [];
    for (const tt of ticketTypes) {
      if (tt.sharedStockKey) {
        const group = pooled.get(tt.sharedStockKey) ?? [];
        group.push(tt);
        pooled.set(tt.sharedStockKey, group);
      } else {
        independent.push(tt);
      }
    }

    for (const tt of independent) {
      const sold = await this.prisma.order.aggregate({
        where: { ticketTypeId: tt.id, status: 'PAID' },
        _sum: { quantity: true },
      });
      const remaining = tt.totalQuantity - (sold._sum.quantity ?? 0);
      await this.inventory.initStock(tt.id, remaining);
      results.push({ id: tt.id, name: tt.name, resetTo: remaining });
    }

    for (const [sharedStockKey, group] of pooled) {
      const poolTotal = group[0].poolTotalQuantity ?? group[0].totalQuantity;
      let totalSold = 0;
      for (const tt of group) {
        const sold = await this.prisma.order.aggregate({
          where: { ticketTypeId: tt.id, status: 'PAID' },
          _sum: { quantity: true },
        });
        totalSold += sold._sum.quantity ?? 0;

        if (tt.maxGroupOrders !== null) {
          const groupOrderCount = await this.prisma.order.count({
            where: { ticketTypeId: tt.id, status: 'PAID' },
          });
          await this.inventory.setGroupOrderCount(tt.id, groupOrderCount);
        }
      }
      const remaining = poolTotal - totalSold;
      await this.inventory.initStock(sharedStockKey, remaining);
      for (const tt of group) {
        results.push({ id: tt.id, name: tt.name, resetTo: remaining });
      }
    }

    return results;
  }

  /** Deletes every synthetic account a load test created (email matches loadtest<n>@gmail.com). */
  async deleteLoadTestUsers() {
    const users = await this.prisma.user.findMany({
      where: { email: { contains: '@gmail.com', mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    const loadTestUsers = users.filter((u) =>
      /^loadtest\d+@gmail\.com$/i.test(u.email),
    );
    for (const u of loadTestUsers) {
      await this.deleteUser(u.id);
    }
    return { deleted: loadTestUsers.length };
  }

  /** When `team` is given, only that team's orders (by registrantTeam) are included. */
  async exportOrdersXlsx(team?: string): Promise<ExcelJS.Buffer> {
    const orders = await this.prisma.order.findMany({
      where: team ? { registrantTeam: team } : undefined,
      include: {
        user: { select: { email: true } },
        ticketType: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Orders');
    sheet.columns = [
      { header: '訂單編號', key: 'id', width: 28 },
      { header: '使用者Email', key: 'email', width: 28 },
      { header: '姓名', key: 'registrantName', width: 14 },
      { header: '所屬系統/團隊', key: 'registrantTeam', width: 16 },
      { header: 'LINE ID', key: 'registrantLineId', width: 16 },
      { header: '電話', key: 'registrantPhone', width: 16 },
      { header: '用餐需求', key: 'mealPreference', width: 14 },
      { header: '票種', key: 'ticketTypeName', width: 16 },
      { header: '張數', key: 'quantity', width: 8 },
      { header: '總金額', key: 'totalAmount', width: 10 },
      { header: '狀態', key: 'status', width: 12 },
      { header: '主揪姓名', key: 'groupLeaderName', width: 14 },
      { header: '主揪LINE ID', key: 'groupLeaderLineId', width: 16 },
      { header: '主揪電話', key: 'groupLeaderPhone', width: 16 },
      { header: '團體成員名單', key: 'groupMembers', width: 40 },
      { header: '同行親友資訊', key: 'companions', width: 40 },
      { header: '全單為代訂親友', key: 'buyingForFamily', width: 14 },
      { header: '兒童座椅需求數', key: 'childSeatCount', width: 14 },
      { header: '建立時間', key: 'createdAt', width: 20 },
      { header: '備註', key: 'adminNote', width: 30 },
    ];

    for (const order of orders) {
      sheet.addRow({
        id: order.id,
        email: order.user.email,
        registrantName: order.registrantName,
        registrantTeam: order.registrantTeam,
        registrantLineId: order.registrantLineId,
        registrantPhone: order.registrantPhone,
        mealPreference: order.mealPreference,
        ticketTypeName: order.ticketType.name,
        quantity: order.quantity,
        totalAmount: order.totalAmount,
        status: order.status,
        groupLeaderName: order.groupLeaderName ?? '',
        groupLeaderLineId: order.groupLeaderLineId ?? '',
        groupLeaderPhone: order.groupLeaderPhone ?? '',
        // Orders placed before this feature stored plain name strings —
        // tolerate that legacy shape here instead of crashing on `.name`.
        groupMembers: Array.isArray(order.groupMembers)
          ? (order.groupMembers as unknown as (GroupMember | string)[])
              .map((m, i) =>
                typeof m === 'string'
                  ? `${i + 1}. ${m || '未填寫'}`
                  : `${i + 1}. ${m.name || '未填寫'}（${m.contact || '未填寫'}／${m.mealPreference || '未填寫'}）`,
              )
              .join('\n')
          : '',
        companions: Array.isArray(order.companions)
          ? (order.companions as unknown as Companion[])
              .map(
                (c, i) =>
                  `第${i + (order.buyingForFamily ? 1 : 2)}張. ${c.name || '未填寫'}（${c.relationship}）／${c.mealPreference || '未填寫'}／備註：${c.note || '未填寫'}`,
              )
              .join('\n')
          : '',
        buyingForFamily: order.buyingForFamily ? '是' : '',
        childSeatCount: order.childSeatCount > 0 ? order.childSeatCount : '',
        createdAt: order.createdAt.toISOString(),
        adminNote: order.adminNote ?? '',
      });
    }

    return workbook.xlsx.writeBuffer();
  }

  /** Moderates a chat message and tells every connected client to remove it live. */
  async deleteChatMessage(id: string) {
    const existing = await this.prisma.chatMessage.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Message ${id} not found`);
    await this.prisma.chatMessage.delete({ where: { id } });
    this.chatGateway.broadcastDeletion(id);
    return { deleted: true };
  }
}
