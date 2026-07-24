import { StockSweepService } from './stock-sweep.service';

function ticketType(overrides: Partial<any> = {}) {
  return {
    id: 'tt-default',
    name: 'ticket',
    fixedQuantity: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function batch(overrides: Partial<any> = {}) {
  return {
    id: 'batch-default',
    sessionId: 'session-1',
    name: 'batch',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ticketTypes: [],
    ...overrides,
  };
}

describe('StockSweepService', () => {
  let prisma: any;
  let inventory: any;
  let service: StockSweepService;

  beforeEach(() => {
    prisma = {
      saleBatch: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      ticketType: {
        update: jest.fn(),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    inventory = {
      getStock: jest.fn(),
      initStock: jest.fn(),
      releaseStock: jest.fn(),
    };
    service = new StockSweepService(prisma, inventory);
  });

  it("sweeps the closing batch's unsold group-ticket capacity into the next batch's non-group ticket", async () => {
    const groupType = ticketType({
      id: 'group-1',
      name: '團體早鳥票',
      fixedQuantity: 11,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    const closingBatch = batch({
      id: 'wave-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ticketTypes: [groupType],
    });
    const targetType = ticketType({
      id: 'general-2',
      name: '一般票',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    });
    const nextBatch = batch({
      id: 'wave-2',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      ticketTypes: [targetType],
    });

    prisma.saleBatch.findUnique.mockResolvedValue(closingBatch);
    prisma.saleBatch.findMany.mockResolvedValue([closingBatch, nextBatch]);
    inventory.getStock.mockResolvedValue(44);

    await (service as any).sweepFromBatch('wave-1');

    expect(inventory.getStock).toHaveBeenCalledWith('group-1');
    expect(inventory.initStock).toHaveBeenCalledWith('group-1', 0);
    expect(inventory.releaseStock).toHaveBeenCalledWith('general-2', 44);
    expect(prisma.ticketType.update).toHaveBeenCalledWith({
      where: { id: 'group-1' },
      data: { totalQuantity: { decrement: 44 } },
    });
    expect(prisma.ticketType.update).toHaveBeenCalledWith({
      where: { id: 'general-2' },
      data: { totalQuantity: { increment: 44 } },
    });
    expect(prisma.saleBatch.update).toHaveBeenCalledWith({
      where: { id: 'wave-1' },
      data: { stockSweepDone: true },
    });
  });

  it('does nothing but marks swept when this is the last batch in its session', async () => {
    const lastBatch = batch({ id: 'wave-1' });
    prisma.saleBatch.findUnique.mockResolvedValue(lastBatch);
    prisma.saleBatch.findMany.mockResolvedValue([lastBatch]);

    await (service as any).sweepFromBatch('wave-1');

    expect(inventory.getStock).not.toHaveBeenCalled();
    expect(inventory.releaseStock).not.toHaveBeenCalled();
    expect(prisma.saleBatch.update).toHaveBeenCalledWith({
      where: { id: 'wave-1' },
      data: { stockSweepDone: true },
    });
  });

  it('skips the transfer but still marks swept when the next batch has no non-group ticket type', async () => {
    const groupType = ticketType({ id: 'group-1', fixedQuantity: 11 });
    const closingBatch = batch({
      id: 'wave-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ticketTypes: [groupType],
    });
    const onlyGroupInNextBatch = ticketType({
      id: 'group-2',
      fixedQuantity: 11,
    });
    const nextBatch = batch({
      id: 'wave-2',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      ticketTypes: [onlyGroupInNextBatch],
    });

    prisma.saleBatch.findUnique.mockResolvedValue(closingBatch);
    prisma.saleBatch.findMany.mockResolvedValue([closingBatch, nextBatch]);

    await (service as any).sweepFromBatch('wave-1');

    expect(inventory.getStock).not.toHaveBeenCalled();
    expect(inventory.releaseStock).not.toHaveBeenCalled();
    expect(prisma.saleBatch.update).toHaveBeenCalledWith({
      where: { id: 'wave-1' },
      data: { stockSweepDone: true },
    });
  });

  it('does not transfer anything when the closing batch has no leftover group stock', async () => {
    const groupType = ticketType({ id: 'group-1', fixedQuantity: 11 });
    const closingBatch = batch({
      id: 'wave-1',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ticketTypes: [groupType],
    });
    const targetType = ticketType({ id: 'general-2' });
    const nextBatch = batch({
      id: 'wave-2',
      createdAt: new Date('2026-02-01T00:00:00Z'),
      ticketTypes: [targetType],
    });

    prisma.saleBatch.findUnique.mockResolvedValue(closingBatch);
    prisma.saleBatch.findMany.mockResolvedValue([closingBatch, nextBatch]);
    inventory.getStock.mockResolvedValue(0);

    await (service as any).sweepFromBatch('wave-1');

    expect(inventory.initStock).not.toHaveBeenCalled();
    expect(inventory.releaseStock).not.toHaveBeenCalled();
    expect(prisma.ticketType.update).not.toHaveBeenCalled();
  });

  describe('shared-pool sweep', () => {
    it('releases unfilled group-member seats back to the pool, then sweeps the remainder into the next wave at its price', async () => {
      const pooledGroupType = ticketType({
        id: 'group-pool-1',
        name: '團體早鳥票',
        fixedQuantity: 11,
        sharedStockKey: 'early-bird-pool',
      });
      const pooledIndividualType = ticketType({
        id: 'individual-pool-1',
        name: '單人早鳥票',
        sharedStockKey: 'early-bird-pool',
      });
      const closingBatch = batch({
        id: 'wave-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ticketTypes: [pooledGroupType, pooledIndividualType],
      });
      const targetType = ticketType({
        id: 'general-2',
        name: '一般票',
        createdAt: new Date('2026-02-01T00:00:00Z'),
      });
      const nextBatch = batch({
        id: 'wave-2',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ticketTypes: [targetType],
      });

      prisma.saleBatch.findUnique.mockResolvedValue(closingBatch);
      prisma.saleBatch.findMany.mockResolvedValue([closingBatch, nextBatch]);
      prisma.order.findMany.mockResolvedValue([
        {
          id: 'order-1',
          groupMembers: [
            { name: 'Filled One', contact: '', mealPreference: '' },
            { name: '', contact: '', mealPreference: '' },
            { name: '   ', contact: '', mealPreference: '' },
          ],
        },
        { id: 'order-2', groupMembers: ['Legacy Filled', ''] },
      ]);
      // First getStock call (after releasing blanks) reports pool remaining.
      inventory.getStock.mockResolvedValue(170);

      await (service as any).sweepFromBatch('wave-1');

      // Released per order: 2 blank object-shaped seats from order-1, 1 blank
      // legacy-string-shaped seat from order-2.
      expect(inventory.releaseStock).toHaveBeenCalledWith('early-bird-pool', 2);
      expect(inventory.releaseStock).toHaveBeenCalledWith('early-bird-pool', 1);
      expect(inventory.initStock).toHaveBeenCalledWith('early-bird-pool', 0);
      expect(inventory.releaseStock).toHaveBeenCalledWith('general-2', 170);
      expect(prisma.ticketType.update).toHaveBeenCalledWith({
        where: { id: 'general-2' },
        data: { totalQuantity: { increment: 170 } },
      });
      // The pool itself has no TicketType row of its own, so no decrement call for it.
      expect(prisma.ticketType.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'group-pool-1' } }),
      );
    });

    it('does nothing for a shared pool that already has zero remaining', async () => {
      const pooledIndividualType = ticketType({
        id: 'individual-pool-1',
        sharedStockKey: 'early-bird-pool',
      });
      const closingBatch = batch({
        id: 'wave-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        ticketTypes: [pooledIndividualType],
      });
      const targetType = ticketType({ id: 'general-2', createdAt: new Date('2026-02-01T00:00:00Z') });
      const nextBatch = batch({
        id: 'wave-2',
        createdAt: new Date('2026-02-01T00:00:00Z'),
        ticketTypes: [targetType],
      });

      prisma.saleBatch.findUnique.mockResolvedValue(closingBatch);
      prisma.saleBatch.findMany.mockResolvedValue([closingBatch, nextBatch]);
      inventory.getStock.mockResolvedValue(0);

      await (service as any).sweepFromBatch('wave-1');

      expect(inventory.initStock).not.toHaveBeenCalled();
      expect(inventory.releaseStock).not.toHaveBeenCalled();
      expect(prisma.ticketType.update).not.toHaveBeenCalled();
    });
  });
});
