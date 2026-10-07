import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let prisma: any;
  let inventory: any;
  let chatGateway: any;
  let service: AdminService;

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue(undefined),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      orderHistory: {
        create: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn(),
      },
    };
    inventory = {
      releaseStock: jest.fn().mockResolvedValue(undefined),
      releaseGroupStock: jest.fn().mockResolvedValue(undefined),
      releaseGroupPurchaseClaim: jest.fn().mockResolvedValue(undefined),
    };
    chatGateway = {};
    service = new AdminService(prisma, inventory, chatGateway);
  });

  describe('updateOrderNote', () => {
    it('updates the note and records an ADMIN_NOTE_UPDATED history entry with before/after', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-1',
        adminNote: '舊備註',
      });
      prisma.order.update.mockResolvedValue({
        id: 'order-1',
        adminNote: '新備註',
      });

      const result = await service.updateOrderNote(
        'order-1',
        '新備註',
        'admin@example.com',
      );

      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { adminNote: '新備註' },
      });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          action: 'ADMIN_NOTE_UPDATED',
          actorLabel: 'admin@example.com',
          before: { adminNote: '舊備註' },
          after: { adminNote: '新備註' },
        }),
      });
      expect(result).toEqual({ id: 'order-1', adminNote: '新備註' });
    });

    it('throws NotFoundException for a nonexistent order and never writes history', async () => {
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(
        service.updateOrderNote('missing', 'note', 'admin@example.com'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderHistory.create).not.toHaveBeenCalled();
    });
  });

  /**
   * Releasing stock before the delete meant a delete that failed (an order
   * referenced by a TicketTransfer used to be undeletable outright) handed
   * the seat back to the pool while the order stayed live — and handed back
   * another on every retry. The release has to trail the commit.
   */
  describe('deleteOrder', () => {
    const individualOrder = {
      id: 'order-1',
      userId: 'user-1',
      quantity: 2,
      status: 'PAID',
      ticketType: {
        id: 'tt-1',
        sessionId: 'session-1',
        fixedQuantity: null,
        sharedStockKey: null,
        maxGroupOrders: null,
      },
    };

    it('releases the stock only after the delete has committed', async () => {
      const calls: string[] = [];
      prisma.order.findUnique.mockResolvedValue(individualOrder);
      prisma.order.delete.mockImplementation(async () => {
        calls.push('delete');
      });
      inventory.releaseStock.mockImplementation(async () => {
        calls.push('release');
      });

      await service.deleteOrder('order-1');

      expect(calls).toEqual(['delete', 'release']);
      expect(inventory.releaseStock).toHaveBeenCalledWith('tt-1', 2);
    });

    it('never releases stock when the delete fails', async () => {
      prisma.order.findUnique.mockResolvedValue(individualOrder);
      prisma.order.delete.mockRejectedValue(new Error('foreign key violation'));

      await expect(service.deleteOrder('order-1')).rejects.toThrow(
        'foreign key violation',
      );
      expect(inventory.releaseStock).not.toHaveBeenCalled();
      expect(inventory.releaseGroupStock).not.toHaveBeenCalled();
    });

    it("frees the buyer's one-bundle-per-session claim for a group order", async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...individualOrder,
        quantity: 11,
        ticketType: {
          id: 'tt-group',
          sessionId: 'session-1',
          fixedQuantity: 11,
          sharedStockKey: 'early-bird-pool',
          maxGroupOrders: 20,
        },
      });

      await service.deleteOrder('order-1');

      expect(inventory.releaseGroupStock).toHaveBeenCalledWith(
        'early-bird-pool',
        'tt-group',
        11,
      );
      // Without this the buyer could never purchase another bundle: the
      // claim has no TTL, so nothing else would ever free it.
      expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith(
        'session-1',
        'user-1',
      );
    });

    it('leaves the stock alone for an already-cancelled order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...individualOrder,
        status: 'CANCELLED',
      });

      await service.deleteOrder('order-1');

      expect(prisma.order.delete).toHaveBeenCalled();
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent order without touching stock', async () => {
      prisma.order.findUnique.mockResolvedValue(null);

      await expect(service.deleteOrder('missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.order.delete).not.toHaveBeenCalled();
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });
  });

  describe('deleteUser', () => {
    it('releases each still-held order only after both deletes have committed', async () => {
      const calls: string[] = [];
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        orders: [
          {
            id: 'order-1',
            userId: 'user-1',
            quantity: 1,
            status: 'PAID',
            ticketType: {
              id: 'tt-1',
              sessionId: 'session-1',
              fixedQuantity: null,
              sharedStockKey: null,
              maxGroupOrders: null,
            },
          },
          {
            id: 'order-2',
            userId: 'user-1',
            quantity: 1,
            status: 'CANCELLED',
            ticketType: {
              id: 'tt-1',
              sessionId: 'session-1',
              fixedQuantity: null,
              sharedStockKey: null,
              maxGroupOrders: null,
            },
          },
        ],
      });
      prisma.order.deleteMany.mockImplementation(async () => {
        calls.push('deleteOrders');
        return { count: 2 };
      });
      prisma.user.delete.mockImplementation(async () => {
        calls.push('deleteUser');
      });
      inventory.releaseStock.mockImplementation(async () => {
        calls.push('release');
      });

      await service.deleteUser('user-1');

      expect(calls).toEqual(['deleteOrders', 'deleteUser', 'release']);
      // Only the PAID order still held a seat.
      expect(inventory.releaseStock).toHaveBeenCalledTimes(1);
    });

    it('never releases stock when deleting the user fails', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        orders: [
          {
            id: 'order-1',
            userId: 'user-1',
            quantity: 1,
            status: 'PAID',
            ticketType: {
              id: 'tt-1',
              sessionId: 'session-1',
              fixedQuantity: null,
              sharedStockKey: null,
              maxGroupOrders: null,
            },
          },
        ],
      });
      prisma.user.delete.mockRejectedValue(new Error('foreign key violation'));

      await expect(service.deleteUser('user-1')).rejects.toThrow(
        'foreign key violation',
      );
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });
  });

  describe('getOrderHistory', () => {
    it("returns the order's history entries newest first", async () => {
      const entries = [
        { id: 'h-2', orderId: 'order-1', action: 'CANCELLED' },
        { id: 'h-1', orderId: 'order-1', action: 'CREATED' },
      ];
      prisma.orderHistory.findMany.mockResolvedValue(entries);

      const result = await service.getOrderHistory('order-1');

      expect(prisma.orderHistory.findMany).toHaveBeenCalledWith({
        where: { orderId: 'order-1' },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(entries);
    });
  });

  describe('updateSeat', () => {
    const groupOrder = {
      id: 'o1',
      status: 'PAID',
      quantity: 3,
      registrantName: '買家',
      mealPreference: '葷食',
      groupLeaderName: '主揪',
      groupMembers: [{ name: '羽萱', contact: '0911', mealPreference: '葷食' }, { name: '', contact: '', mealPreference: '' }],
      companions: null,
      buyingForFamily: false,
      ticketType: { fixedQuantity: 2 },
    };

    it('writes the edited member list and records ADMIN_SEAT_EDITED with before/after', async () => {
      prisma.order.findUnique.mockResolvedValue(groupOrder);
      prisma.order.update.mockResolvedValue({});

      await service.updateSeat('o1', 1, { name: '洪羽萱' }, 'admin@x.com');

      const written = prisma.order.update.mock.calls[0][0];
      expect(written.where).toEqual({ id: 'o1' });
      expect(written.data.groupMembers[0].name).toBe('洪羽萱');
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'o1',
          action: 'ADMIN_SEAT_EDITED',
          actorLabel: 'admin@x.com',
          before: { seatIndex: 1, name: '羽萱', mealPreference: '葷食' },
          after: { seatIndex: 1, name: '洪羽萱', mealPreference: '葷食' },
        }),
      });
    });

    it('refuses a cancelled order and an unknown order', async () => {
      prisma.order.findUnique.mockResolvedValue({ ...groupOrder, status: 'CANCELLED' });
      await expect(service.updateSeat('o1', 1, { name: 'x' }, 'a')).rejects.toThrow(BadRequestException);
      prisma.order.findUnique.mockResolvedValue(null);
      await expect(service.updateSeat('nope', 1, { name: 'x' }, 'a')).rejects.toThrow(NotFoundException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('updateOrderTeam', () => {
    it('changes the team and records ADMIN_TEAM_CHANGED; a no-op writes nothing', async () => {
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', registrantTeam: '朱佳期' });
      prisma.order.update.mockResolvedValue({});
      await service.updateOrderTeam('o1', '子揚', 'admin@x.com');
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { registrantTeam: '子揚' },
      });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'ADMIN_TEAM_CHANGED',
          before: { registrantTeam: '朱佳期' },
          after: { registrantTeam: '子揚' },
        }),
      });

      prisma.order.update.mockClear();
      prisma.orderHistory.create.mockClear();
      await service.updateOrderTeam('o1', '朱佳期', 'admin@x.com');
      expect(prisma.order.update).not.toHaveBeenCalled();
      expect(prisma.orderHistory.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrder', () => {
    const paid = (over: object = {}) => ({
      id: 'o1',
      userId: 'u1',
      status: 'PAID',
      quantity: 1,
      tickets: [{ checkedInAt: null }],
      ticketType: { id: 'tt1', sessionId: 's1', fixedQuantity: null, sharedStockKey: null, maxGroupOrders: null },
      ...over,
    });

    it('flips PAID to CANCELLED, releases stock once, keeps the row, records history', async () => {
      prisma.order.findUnique.mockResolvedValue(paid());
      await service.cancelOrder('o1', 'admin@x.com');

      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'o1', status: { in: ['PENDING', 'PAID'] } },
        data: { status: 'CANCELLED' },
      });
      expect(inventory.releaseStock).toHaveBeenCalledTimes(1);
      expect(inventory.releaseStock).toHaveBeenCalledWith('tt1', 1);
      expect(prisma.order.delete).not.toHaveBeenCalled();
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'o1',
          action: 'ADMIN_CANCELLED',
          actorLabel: 'admin@x.com',
          before: { status: 'PAID' },
          after: { status: 'CANCELLED' },
        }),
      });
    });

    it('releases the group claim for a group bundle', async () => {
      prisma.order.findUnique.mockResolvedValue(
        paid({ quantity: 11, ticketType: { id: 'tt1', sessionId: 's1', fixedQuantity: 10, sharedStockKey: 'pool', maxGroupOrders: 5 } }),
      );
      await service.cancelOrder('o1', 'a');
      expect(inventory.releaseGroupStock).toHaveBeenCalledWith('pool', 'tt1', 11);
      expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith('s1', 'u1');
    });

    it('refuses an already-cancelled order and releases nothing', async () => {
      prisma.order.findUnique.mockResolvedValue(paid({ status: 'CANCELLED' }));
      await expect(service.cancelOrder('o1', 'a')).rejects.toThrow(BadRequestException);
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });

    it('a lost race (status already flipped) releases nothing', async () => {
      prisma.order.findUnique.mockResolvedValue(paid());
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancelOrder('o1', 'a')).rejects.toThrow(BadRequestException);
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });

    it('refuses an order someone already checked in to', async () => {
      prisma.order.findUnique.mockResolvedValue(paid({ tickets: [{ checkedInAt: new Date() }] }));
      await expect(service.cancelOrder('o1', 'a')).rejects.toThrow('已有人現場報到');
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('restores the status if releasing stock fails', async () => {
      prisma.order.findUnique.mockResolvedValue(paid());
      prisma.order.update.mockResolvedValue({});
      inventory.releaseStock.mockRejectedValue(new Error('redis down'));
      await expect(service.cancelOrder('o1', 'a')).rejects.toThrow('redis down');
      expect(prisma.order.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { status: 'PAID' } });
      expect(prisma.orderHistory.create).not.toHaveBeenCalled();
    });
  });
});
