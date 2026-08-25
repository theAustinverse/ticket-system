import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EventService } from './event.service';

describe('EventService', () => {
  let prisma: any;
  let inventory: any;
  let service: EventService;

  beforeEach(() => {
    prisma = {
      saleBatch: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      ticketType: {
        findUnique: jest.fn(),
        update: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn((ops) => Promise.all(ops)),
    };
    inventory = {
      initStock: jest.fn().mockResolvedValue(undefined),
      initStockIfAbsent: jest.fn().mockResolvedValue(undefined),
      takeAllStock: jest.fn().mockResolvedValue(0),
    };
    service = new EventService(prisma, inventory);
  });

  describe('updateTicketType', () => {
    const existing = {
      id: 'tt-1',
      batch: { id: 'batch-1' },
      totalQuantity: 158,
    };

    it('writes totalQuantity to Postgres without touching Redis', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(existing);
      prisma.ticketType.update.mockResolvedValue({ ...existing, totalQuantity: 150 });

      const result = await service.updateTicketType('tt-1', { totalQuantity: 150 });

      expect(prisma.ticketType.update).toHaveBeenCalledWith({
        where: { id: 'tt-1' },
        data: { totalQuantity: 150 },
      });
      // The whole point of this method not resyncing Redis itself: a caller
      // must follow with AdminService.resetStock, exactly as its doc comment
      // says. If this ever starts calling inventory directly, the frontend's
      // "save then resetStock" flow would double-apply the change.
      expect(inventory.initStock).not.toHaveBeenCalled();
      expect(inventory.initStockIfAbsent).not.toHaveBeenCalled();
      expect(result.totalQuantity).toBe(150);
    });

    it('throws NotFoundException for a nonexistent ticket type and never writes', async () => {
      prisma.ticketType.findUnique.mockResolvedValue(null);

      await expect(
        service.updateTicketType('missing', { totalQuantity: 150 }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.ticketType.update).not.toHaveBeenCalled();
    });
  });

  describe('updateBatch', () => {
    const existing = { id: 'batch-1', saleStartAt: null, saleEndAt: null };

    it('sets saleStartAt from an ISO string', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue(existing);
      prisma.saleBatch.update.mockResolvedValue({
        ...existing,
        saleStartAt: new Date('2026-08-15T04:00:00.000Z'),
      });

      await service.updateBatch('batch-1', {
        saleStartAt: '2026-08-15T04:00:00.000Z',
      });

      expect(prisma.saleBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { saleStartAt: new Date('2026-08-15T04:00:00.000Z') },
      });
    });

    it('locks the batch back to TBD when saleStartAt is explicitly null', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue({
        ...existing,
        saleStartAt: new Date('2026-08-15T04:00:00.000Z'),
      });
      prisma.saleBatch.update.mockResolvedValue({ ...existing, saleStartAt: null });

      await service.updateBatch('batch-1', { saleStartAt: null });

      expect(prisma.saleBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { saleStartAt: null },
      });
    });

    it('leaves saleStartAt untouched when the field is omitted entirely', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue(existing);
      prisma.saleBatch.update.mockResolvedValue(existing);

      await service.updateBatch('batch-1', { saleEndAt: '2026-08-21T16:00:00.000Z' });

      expect(prisma.saleBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { saleEndAt: new Date('2026-08-21T16:00:00.000Z') },
      });
    });

    it('throws NotFoundException for a nonexistent batch and never writes', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue(null);

      await expect(
        service.updateBatch('missing', { saleStartAt: '2026-08-15T04:00:00.000Z' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.saleBatch.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteBatch', () => {
    it('deletes an unsold batch and zeroes each independent ticket type in Redis', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue({
        id: 'batch-3',
        ticketTypes: [
          { id: 'tt-3', name: '最後席次票', sharedStockKey: null, orders: [] },
        ],
      });

      const result = await service.deleteBatch('batch-3');

      expect(inventory.takeAllStock).toHaveBeenCalledWith('tt-3');
      expect(prisma.ticketType.deleteMany).toHaveBeenCalledWith({
        where: { batchId: 'batch-3' },
      });
      expect(prisma.saleBatch.delete).toHaveBeenCalledWith({ where: { id: 'batch-3' } });
      expect(result).toEqual({ deleted: true });
    });

    it('refuses to delete a batch whose ticket type already has an order', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        ticketTypes: [
          { id: 'tt-1', name: '團體早鳥票', sharedStockKey: 'early-bird-pool', orders: [{ id: 'order-1' }] },
        ],
      });

      await expect(service.deleteBatch('batch-1')).rejects.toThrow(BadRequestException);
      expect(prisma.ticketType.deleteMany).not.toHaveBeenCalled();
      expect(prisma.saleBatch.delete).not.toHaveBeenCalled();
      expect(inventory.takeAllStock).not.toHaveBeenCalled();
    });

    it('never zeroes Redis for a pooled ticket type — the pool may still be live for a sibling in another batch', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue({
        id: 'batch-3',
        ticketTypes: [
          { id: 'tt-3', name: '共用池票種', sharedStockKey: 'some-pool', orders: [] },
        ],
      });

      await service.deleteBatch('batch-3');

      expect(inventory.takeAllStock).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a nonexistent batch and touches nothing', async () => {
      prisma.saleBatch.findUnique.mockResolvedValue(null);

      await expect(service.deleteBatch('missing')).rejects.toThrow(NotFoundException);
      expect(prisma.ticketType.deleteMany).not.toHaveBeenCalled();
      expect(prisma.saleBatch.delete).not.toHaveBeenCalled();
    });
  });
});
