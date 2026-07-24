import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import type { GroupMember } from '../order/types/group-member';

/** How often to check for a just-opened batch that needs its sweep run. */
const SWEEP_CHECK_INTERVAL_MS = 60_000;

/** Tolerates the legacy plain-string member shape (see admin.service.ts/MyTicketsPage.tsx). */
function isBlankMember(member: GroupMember | string | null | undefined): boolean {
  if (!member) return true;
  if (typeof member === 'string') return !member.trim();
  return !member.name?.trim();
}

/**
 * When a wave's own sale window closes (SaleBatch.saleEndAt reached),
 * whatever's left of it is gone for good — released to whoever's buying in
 * the *next* wave, at that wave's price (no more early-bird discount),
 * regardless of whether the next wave has itself opened for purchase yet.
 * Wave order is inferred from SaleBatch.createdAt within the same session
 * (earliest = wave 1), and the released capacity lands on the earliest
 * non-group ticket type in the next batch. Each batch is swept at most once,
 * guarded by SaleBatch.stockSweepDone (set on the batch being swept FROM),
 * so this is safe to poll repeatedly. A batch with no saleEndAt never
 * triggers a sweep on its own.
 *
 * Two independent sources of leftover capacity from the closing wave:
 * - A plain (non-pooled) group ticket type's unsold bundles.
 * - A shared stock pool (see TicketType.sharedStockKey): first, any PAID
 *   group order's still-blank member seats are released back to the pool
 *   (that buyer already occupies one of the pool's 20-bundle allowance
 *   regardless — only the unfilled *seats* revert, not the whole order);
 *   then whatever the pool has left over sweeps into the next wave.
 */
@Injectable()
export class StockSweepService {
  private readonly logger = new Logger(StockSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  @Interval(SWEEP_CHECK_INTERVAL_MS)
  private async checkForClosedBatches() {
    const dueBatches = await this.prisma.saleBatch.findMany({
      where: {
        stockSweepDone: false,
        saleEndAt: { not: null, lte: new Date() },
      },
    });

    for (const batch of dueBatches) {
      await this.sweepFromBatch(batch.id);
    }
  }

  private async sweepFromBatch(batchId: string) {
    const batch = await this.prisma.saleBatch.findUnique({
      where: { id: batchId },
      include: { ticketTypes: true },
    });
    if (!batch) return;

    const siblingBatches = await this.prisma.saleBatch.findMany({
      where: { sessionId: batch.sessionId },
      // createdAt alone doesn't disambiguate batches bulk-inserted in the
      // same millisecond — id is a secondary sort key (cuids are
      // chronologically sortable) so wave order stays stable either way.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { ticketTypes: true },
    });
    const index = siblingBatches.findIndex((b) => b.id === batchId);
    const nextBatch = index >= 0 && index < siblingBatches.length - 1
      ? siblingBatches[index + 1]
      : null;

    if (!nextBatch) {
      this.logger.warn(
        `Batch ${batch.name} (${batchId}) closed but there is no next wave to sweep leftover capacity into; skipping sweep.`,
      );
      await this.markSwept(batchId);
      return;
    }

    const target = [...nextBatch.ticketTypes]
      .filter((tt) => tt.fixedQuantity === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!target) {
      this.logger.warn(
        `Batch ${batch.name} (${batchId}) closed but ${nextBatch.name} has no non-group ticket type to sweep leftover capacity into; skipping sweep.`,
      );
      await this.markSwept(batchId);
      return;
    }

    let totalReleased = 0;

    const plainGroupTypes = batch.ticketTypes.filter(
      (tt) => tt.fixedQuantity !== null && !tt.sharedStockKey,
    );
    for (const groupType of plainGroupTypes) {
      const remaining = await this.inventory.getStock(groupType.id);
      if (!remaining || remaining <= 0) continue;

      await this.inventory.initStock(groupType.id, 0);
      await this.inventory.releaseStock(target.id, remaining);
      await this.prisma.ticketType.update({
        where: { id: groupType.id },
        data: { totalQuantity: { decrement: remaining } },
      });
      await this.prisma.ticketType.update({
        where: { id: target.id },
        data: { totalQuantity: { increment: remaining } },
      });
      totalReleased += remaining;

      this.logger.log(
        `Swept ${remaining} unsold seats from "${groupType.name}" (${batch.name}) into "${target.name}" (${nextBatch.name}) as ${batch.name} closed.`,
      );
    }

    const pooledTypes = batch.ticketTypes.filter((tt) => tt.sharedStockKey);
    const poolKeys = new Set(pooledTypes.map((tt) => tt.sharedStockKey as string));
    for (const poolKey of poolKeys) {
      const typesInPool = pooledTypes.filter((tt) => tt.sharedStockKey === poolKey);

      let releasedFromBlankMembers = 0;
      for (const groupType of typesInPool.filter((tt) => tt.fixedQuantity !== null)) {
        const paidOrders = await this.prisma.order.findMany({
          where: { ticketTypeId: groupType.id, status: 'PAID' },
          select: { id: true, groupMembers: true },
        });
        for (const order of paidOrders) {
          const members = Array.isArray(order.groupMembers)
            ? (order.groupMembers as unknown as (GroupMember | string)[])
            : [];
          const blankCount = members.filter(isBlankMember).length;
          if (blankCount > 0) {
            await this.inventory.releaseStock(poolKey, blankCount);
            releasedFromBlankMembers += blankCount;
          }
        }
      }
      if (releasedFromBlankMembers > 0) {
        this.logger.log(
          `Released ${releasedFromBlankMembers} unfilled group-member seat(s) from the shared pool "${poolKey}" back to stock as ${batch.name} closed.`,
        );
      }

      const poolRemaining = await this.inventory.getStock(poolKey);
      if (poolRemaining && poolRemaining > 0) {
        await this.inventory.initStock(poolKey, 0);
        await this.inventory.releaseStock(target.id, poolRemaining);
        await this.prisma.ticketType.update({
          where: { id: target.id },
          data: { totalQuantity: { increment: poolRemaining } },
        });
        totalReleased += poolRemaining;

        const poolNames = typesInPool.map((tt) => tt.name).join('、');
        this.logger.log(
          `Swept ${poolRemaining} unsold seats from the shared pool "${poolKey}" (${poolNames}) into "${target.name}" (${nextBatch.name}) as ${batch.name} closed — no longer available at the early-bird price.`,
        );
      }
    }

    await this.markSwept(batchId);
    if (totalReleased === 0) {
      this.logger.log(
        `${batch.name} closed; no leftover capacity to sweep into ${nextBatch.name}.`,
      );
    }
  }

  private async markSwept(batchId: string) {
    await this.prisma.saleBatch.update({
      where: { id: batchId },
      data: { stockSweepDone: true },
    });
  }
}
