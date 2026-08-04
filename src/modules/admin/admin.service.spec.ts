import { NotFoundException } from '@nestjs/common';
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
      },
      orderHistory: {
        create: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn(),
      },
    };
    inventory = {};
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
});
