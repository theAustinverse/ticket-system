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
});
