import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';
import {
  GroupOrderCapReachedError,
  InsufficientStockError,
} from '../inventory/inventory.service';
import { SaleNotOpenError } from '../event/event.service';

describe('OrderService', () => {
  let prisma: any;
  let inventory: any;
  let eventService: any;
  let emailService: any;
  let service: OrderService;

  const groupTicketType = {
    id: 'tt-group',
    price: 2000,
    fixedQuantity: 11,
    sessionId: 'session-1',
  };

  function makeMembers(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      name: `Member ${i + 1}`,
      contact: `member-${i + 1}-line`,
      mealPreference: '葷食',
    }));
  }

  const validGroupOrderDto = {
    ticketTypeId: 'tt-group',
    quantity: 11,
    registrantName: 'Leader',
    registrantTeam: 'Team',
    registrantLineId: 'leader-line',
    registrantPhone: '0900000000',
    mealPreference: '葷食',
    groupLeaderName: 'Leader',
    groupLeaderLineId: 'leader-line',
    groupLeaderPhone: '0900000000',
    groupMembers: makeMembers(10),
  };

  let queueRoomService: any;

  beforeEach(() => {
    prisma = {
      order: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn(),
      },
      $transaction: jest.fn(),
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', email: 'user@gmail.com' }),
      },
    };
    inventory = {
      decrementStock: jest.fn(),
      releaseStock: jest.fn(),
      decrementGroupStock: jest.fn(),
      releaseGroupStock: jest.fn(),
      claimGroupPurchase: jest.fn().mockResolvedValue(true),
      releaseGroupPurchaseClaim: jest.fn().mockResolvedValue(undefined),
    };
    eventService = {
      findTicketType: jest.fn().mockResolvedValue(groupTicketType),
      assertOnSale: jest.fn().mockResolvedValue(undefined),
    };
    emailService = {
      sendOrderConfirmation: jest.fn(),
      sendTransferInvite: jest.fn(),
      sendTransferSentNotice: jest.fn(),
      sendTransferAdminNotice: jest.fn().mockResolvedValue(undefined),
    };
    queueRoomService = {
      consumeAdmission: jest.fn().mockResolvedValue(undefined),
    };
    service = new OrderService(
      prisma,
      inventory,
      eventService,
      emailService,
      queueRoomService,
    );
  });

  it('rejects orders before the ticket type sale batch has opened', async () => {
    eventService.assertOnSale.mockRejectedValue(
      new SaleNotOpenError('tt-group'),
    );
    await expect(
      service.createOrder('user-1', { ticketTypeId: 'tt-group', quantity: 11 }),
    ).rejects.toThrow(BadRequestException);
    expect(inventory.decrementStock).not.toHaveBeenCalled();
  });

  it('rejects a quantity that does not match fixedQuantity', async () => {
    await expect(
      service.createOrder('user-1', { ticketTypeId: 'tt-group', quantity: 5 }),
    ).rejects.toThrow(BadRequestException);
    expect(inventory.decrementStock).not.toHaveBeenCalled();
  });

  it('accepts a quantity matching fixedQuantity and snapshots totalAmount', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.createOrder('user-1', validGroupOrderDto);

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalAmount: 22000, quantity: 11 }),
      }),
    );
  });

  it('rolls back the Redis reservation if persisting the order fails', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.createOrder('user-1', validGroupOrderDto),
    ).rejects.toThrow('db down');
    expect(inventory.releaseStock).toHaveBeenCalledWith('tt-group', 11);
  });

  it('rejects a second group-ticket order from the same user in the same session', async () => {
    inventory.claimGroupPurchase.mockResolvedValue(false);
    await expect(
      service.createOrder('user-1', validGroupOrderDto),
    ).rejects.toThrow(BadRequestException);
    expect(inventory.decrementStock).not.toHaveBeenCalled();
    expect(inventory.decrementGroupStock).not.toHaveBeenCalled();
  });

  it('releases the group-purchase claim if order creation fails after claiming it', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockRejectedValue(new Error('db down'));
    await expect(
      service.createOrder('user-1', validGroupOrderDto),
    ).rejects.toThrow('db down');
    expect(inventory.claimGroupPurchase).toHaveBeenCalledWith(
      'session-1',
      'user-1',
    );
    expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith(
      'session-1',
      'user-1',
    );
  });

  it('consumes the queue admission token after a successful order', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockResolvedValue({ id: 'order-1' });
    await service.createOrder('user-1', validGroupOrderDto, 'queue-token-1');
    expect(queueRoomService.consumeAdmission).toHaveBeenCalledWith(
      'tt-group',
      'queue-token-1',
    );
  });

  it('surfaces insufficient stock as a BadRequestException', async () => {
    inventory.decrementStock.mockRejectedValue(
      new InsufficientStockError('tt-group'),
    );
    await expect(
      service.createOrder('user-1', validGroupOrderDto),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts blank member fields at order time (deadline is before the next wave, not at purchase)', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.createOrder('user-1', {
      ...validGroupOrderDto,
      groupMembers: [
        { name: 'Only One Filled In', contact: '', mealPreference: '' },
        ...Array.from({ length: 9 }, () => ({
          name: '',
          contact: '',
          mealPreference: '',
        })),
      ],
    });

    expect(prisma.order.create).toHaveBeenCalled();
  });

  it('still rejects a groupMembers array of the wrong length', async () => {
    await expect(
      service.createOrder('user-1', {
        ...validGroupOrderDto,
        groupMembers: makeMembers(1),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  describe('updateGroupMembers', () => {
    const existingOrder = {
      id: 'order-1',
      userId: 'user-1',
      ticketType: {
        ...groupTicketType,
        // Far enough in the future that the "event already happened" guard
        // never trips for these tests.
        session: { startTime: new Date('2099-01-01T00:00:00Z') },
        batch: { saleEndAt: null },
      },
    };

    beforeEach(() => {
      prisma.order.findUnique = jest.fn().mockResolvedValue(existingOrder);
      prisma.order.update = jest.fn().mockResolvedValue({
        ...existingOrder,
        groupMembers: makeMembers(10),
      });
    });

    it('updates the member list for the order owner', async () => {
      const members = makeMembers(10);
      await service.updateGroupMembers('user-1', 'order-1', members);
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { groupMembers: members },
      });
    });

    it('includes childSeatCount in the update when provided', async () => {
      const members = makeMembers(10);
      await service.updateGroupMembers('user-1', 'order-1', members, 3);
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { groupMembers: members, childSeatCount: 3 },
      });
    });

    it('rejects when the order belongs to someone else', async () => {
      await expect(
        service.updateGroupMembers('someone-else', 'order-1', []),
      ).rejects.toThrow();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects a groupMembers array of the wrong length', async () => {
      await expect(
        service.updateGroupMembers('user-1', 'order-1', makeMembers(1)),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects editing the member list once the event has already happened', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...existingOrder,
        ticketType: {
          ...groupTicketType,
          session: { startTime: new Date('2000-01-01T00:00:00Z') },
          batch: { saleEndAt: null },
        },
      });
      await expect(
        service.updateGroupMembers('user-1', 'order-1', makeMembers(10)),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects updating a non-group order', async () => {
      prisma.order.findUnique.mockResolvedValue({
        id: 'order-2',
        userId: 'user-1',
        ticketType: {
          ...groupTicketType,
          fixedQuantity: null,
          batch: { saleEndAt: null },
        },
      });
      await expect(
        service.updateGroupMembers('user-1', 'order-2', []),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects editing the member list once the batch has closed (saleEndAt passed)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...existingOrder,
        ticketType: {
          ...groupTicketType,
          session: { startTime: new Date('2099-01-01T00:00:00Z') },
          batch: { saleEndAt: new Date('2020-01-01T00:00:00Z') },
        },
      });
      await expect(
        service.updateGroupMembers('user-1', 'order-1', makeMembers(10)),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });
  });

  describe('cancelOrder', () => {
    function makeCancellableOrder(ticketType: any, batchOverrides: any = {}) {
      return {
        id: 'order-1',
        userId: 'user-1',
        quantity: ticketType.fixedQuantity ?? 1,
        status: 'PAID',
        ticketTypeId: ticketType.id,
        ticketType: {
          ...ticketType,
          session: { startTime: new Date('2099-01-01T00:00:00Z') },
          batch: { saleEndAt: null, ...batchOverrides },
        },
      };
    }

    it('releases plain stock for a non-pooled ticket type', async () => {
      const order = makeCancellableOrder(groupTicketType);
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      prisma.order.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ ...order, status: 'CANCELLED' });
      await service.cancelOrder('user-1', 'order-1');
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { id: 'order-1', status: 'PAID' },
        data: { status: 'CANCELLED' },
      });
      expect(inventory.releaseStock).toHaveBeenCalledWith('tt-group', 11);
      expect(inventory.releaseGroupStock).not.toHaveBeenCalled();
      expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith(
        'session-1',
        'user-1',
      );
    });

    it('releases via the shared pool + group counter for a pooled group ticket type', async () => {
      const pooledTicketType = {
        ...groupTicketType,
        sharedStockKey: 'early-bird-pool',
        maxGroupOrders: 20,
      };
      const order = makeCancellableOrder(pooledTicketType);
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      prisma.order.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ ...order, status: 'CANCELLED' });
      await service.cancelOrder('user-1', 'order-1');
      expect(inventory.releaseGroupStock).toHaveBeenCalledWith(
        'early-bird-pool',
        'tt-group',
        11,
      );
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });

    it("rejects cancellation once the ticket's own batch has closed (saleEndAt passed)", async () => {
      const order = makeCancellableOrder(groupTicketType, {
        saleEndAt: new Date('2020-01-01T00:00:00Z'),
      });
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      await expect(service.cancelOrder('user-1', 'order-1')).rejects.toThrow(
        'This wave has closed',
      );
      expect(inventory.releaseStock).not.toHaveBeenCalled();
      expect(inventory.releaseGroupStock).not.toHaveBeenCalled();
      expect(prisma.order.updateMany).not.toHaveBeenCalled();
    });

    it('rejects cancellation if the order was already cancelled concurrently (double-cancel race)', async () => {
      const order = makeCancellableOrder(groupTicketType);
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.cancelOrder('user-1', 'order-1')).rejects.toThrow(
        'cannot be cancelled',
      );
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });

    it('reverts the cancellation if releasing stock throws', async () => {
      const order = makeCancellableOrder(groupTicketType);
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      prisma.order.update = jest.fn().mockResolvedValue(order);
      inventory.releaseStock.mockRejectedValue(new Error('redis down'));
      await expect(service.cancelOrder('user-1', 'order-1')).rejects.toThrow(
        'redis down',
      );
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { status: 'PAID' },
      });
    });

    it('still allows cancellation when the batch has a saleEndAt in the future', async () => {
      const order = makeCancellableOrder(groupTicketType, {
        saleEndAt: new Date('2099-06-01T00:00:00Z'),
      });
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      prisma.order.update = jest
        .fn()
        .mockResolvedValue({ ...order, status: 'CANCELLED' });
      await service.cancelOrder('user-1', 'order-1');
      expect(inventory.releaseStock).toHaveBeenCalledWith('tt-group', 11);
    });
  });

  describe('acceptTransfer', () => {
    it('emails the admin team with the transfer details once accepted', async () => {
      prisma.ticketTransfer = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'transfer-1',
          orderId: 'order-1',
          toUserId: 'user-2',
          status: 'PENDING',
          order: {
            status: 'PAID',
            mealPreference: '素食',
            buyingForFamily: true,
            ticketType: { batch: {} },
          },
          fromUser: { name: '王小明' },
          toUser: { name: '陳小華' },
        }),
        update: jest.fn(),
      };
      prisma.$transaction = jest
        .fn()
        .mockResolvedValue([null, { id: 'order-1', userId: 'user-2' }]);

      await service.acceptTransfer('user-2', 'transfer-1');

      expect(emailService.sendTransferAdminNotice).toHaveBeenCalledWith({
        fromName: '王小明',
        toName: '陳小華',
        mealPreference: '素食',
        buyingForFamily: true,
      });
    });

    it('does not fail the transfer if the admin notice email throws', async () => {
      prisma.ticketTransfer = {
        findUnique: jest.fn().mockResolvedValue({
          id: 'transfer-1',
          orderId: 'order-1',
          toUserId: 'user-2',
          status: 'PENDING',
          order: {
            status: 'PAID',
            mealPreference: '葷食',
            buyingForFamily: false,
            ticketType: { batch: {} },
          },
          fromUser: { name: null },
          toUser: { name: null },
        }),
        update: jest.fn(),
      };
      prisma.$transaction = jest
        .fn()
        .mockResolvedValue([null, { id: 'order-1', userId: 'user-2' }]);
      emailService.sendTransferAdminNotice.mockRejectedValue(
        new Error('resend down'),
      );

      const result = await service.acceptTransfer('user-2', 'transfer-1');
      expect(result).toEqual({ id: 'order-1', userId: 'user-2' });
    });
  });

  describe('findOrder', () => {
    it('returns the order to its owner', async () => {
      prisma.order.findUnique = jest.fn().mockResolvedValue({
        id: 'order-1',
        userId: 'user-1',
        registrantName: 'Leader',
      });
      const order = await service.findOrder('user-1', 'order-1');
      expect(order.id).toBe('order-1');
    });

    it('rejects a request from anyone other than the order owner (IDOR guard)', async () => {
      prisma.order.findUnique = jest.fn().mockResolvedValue({
        id: 'order-1',
        userId: 'user-1',
        registrantName: 'Leader',
      });
      await expect(
        service.findOrder('someone-else', 'order-1'),
      ).rejects.toThrow();
    });

    it('throws NotFoundException for a nonexistent order', async () => {
      prisma.order.findUnique = jest.fn().mockResolvedValue(null);
      await expect(service.findOrder('user-1', 'missing')).rejects.toThrow();
    });
  });

  describe('multi-quantity individual ticket with companions', () => {
    const individualTicketType = {
      id: 'tt-individual',
      price: 2200,
      fixedQuantity: null,
      maxQuantityPerOrder: 5,
      sessionId: 'session-1',
    };

    const CHINESE_NAMES = ['王小明', '陳小華', '林小美', '張小強'];

    function makeCompanions(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        name: CHINESE_NAMES[i],
        relationship: '父母',
        mealPreference: '葷食',
        note: '測試備註',
      }));
    }

    const baseDto = {
      ticketTypeId: 'tt-individual',
      registrantName: '王小明',
      registrantTeam: 'Team',
      registrantLineId: 'buyer-line',
      registrantPhone: '0900000000',
      mealPreference: '葷食',
    };

    beforeEach(() => {
      eventService.findTicketType.mockResolvedValue(individualTicketType);
    });

    it('accepts a single ticket with no companions (existing behavior unchanged)', async () => {
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', { ...baseDto, quantity: 1 });
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('accepts up to maxQuantityPerOrder with matching companions', async () => {
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', {
        ...baseDto,
        quantity: 5,
        companions: makeCompanions(4),
      });
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 5, totalAmount: 11000 }),
        }),
      );
    });

    it('rejects a quantity above maxQuantityPerOrder', async () => {
      await expect(
        service.createOrder('user-1', {
          ...baseDto,
          quantity: 6,
          companions: makeCompanions(5),
        }),
      ).rejects.toThrow(BadRequestException);
      expect(inventory.decrementStock).not.toHaveBeenCalled();
    });

    it('rejects quantity > 1 on an ordinary individual ticket type with no maxQuantityPerOrder', async () => {
      eventService.findTicketType.mockResolvedValue({
        ...individualTicketType,
        maxQuantityPerOrder: null,
      });
      await expect(
        service.createOrder('user-1', {
          ...baseDto,
          quantity: 2,
          companions: makeCompanions(1),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a companions array of the wrong length', async () => {
      await expect(
        service.createOrder('user-1', {
          ...baseDto,
          quantity: 3,
          companions: makeCompanions(1),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a companion name that is not Chinese characters only', async () => {
      await expect(
        service.createOrder('user-1', {
          ...baseDto,
          quantity: 2,
          companions: [
            {
              name: 'John',
              relationship: '父母',
              mealPreference: '葷食',
              note: '測試備註',
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a registrantName that is not Chinese characters only', async () => {
      await expect(
        service.createOrder('user-1', {
          ...baseDto,
          registrantName: 'John',
          quantity: 1,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persists the order-level child-seat survey count', async () => {
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', {
        ...baseDto,
        quantity: 2,
        companions: makeCompanions(1),
        childSeatCount: 3,
      });
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ childSeatCount: 3 }),
        }),
      );
    });

    it('defaults childSeatCount to 0 when omitted', async () => {
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', { ...baseDto, quantity: 1 });
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ childSeatCount: 0 }),
        }),
      );
    });

    it('rejects buyingForFamily: true without a companions entry for ticket #1', async () => {
      await expect(
        service.createOrder('user-1', {
          ...baseDto,
          quantity: 1,
          buyingForFamily: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts buyingForFamily: true with one companion entry per ticket (including #1)', async () => {
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', {
        ...baseDto,
        registrantName: 'not-chinese-but-exempt-when-buying-for-family',
        quantity: 1,
        buyingForFamily: true,
        companions: makeCompanions(1),
      });
      expect(prisma.order.create).toHaveBeenCalled();
    });

    it('requires quantity companion entries (not quantity - 1) when buyingForFamily is true', async () => {
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', {
        ...baseDto,
        quantity: 3,
        buyingForFamily: true,
        companions: makeCompanions(3),
      });
      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ quantity: 3, buyingForFamily: true }),
        }),
      );
    });

    it('does not require the one-group-order-per-session check for individual tickets', async () => {
      prisma.order.findFirst.mockResolvedValue({ id: 'some-other-order' });
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', { ...baseDto, quantity: 1 });
      expect(prisma.order.create).toHaveBeenCalled();
    });
  });

  describe('shared-pool group ticket with a bundle cap', () => {
    const pooledGroupTicketType = {
      ...groupTicketType,
      sharedStockKey: 'early-bird-pool',
      maxGroupOrders: 20,
    };

    beforeEach(() => {
      eventService.findTicketType.mockResolvedValue(pooledGroupTicketType);
    });

    it('decrements the shared pool with the group-cap-aware script, not the plain one', async () => {
      inventory.decrementGroupStock.mockResolvedValue(139);
      prisma.order.create.mockResolvedValue({ id: 'order-1' });
      await service.createOrder('user-1', validGroupOrderDto);
      expect(inventory.decrementGroupStock).toHaveBeenCalledWith(
        'early-bird-pool',
        'tt-group',
        11,
        20,
      );
      expect(inventory.decrementStock).not.toHaveBeenCalled();
    });

    it('surfaces a reached group-order cap as a BadRequestException', async () => {
      inventory.decrementGroupStock.mockRejectedValue(
        new GroupOrderCapReachedError('tt-group'),
      );
      await expect(
        service.createOrder('user-1', validGroupOrderDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('releases via the group-cap-aware release on order.create failure', async () => {
      inventory.decrementGroupStock.mockResolvedValue(139);
      prisma.order.create.mockRejectedValue(new Error('db down'));
      await expect(
        service.createOrder('user-1', validGroupOrderDto),
      ).rejects.toThrow('db down');
      expect(inventory.releaseGroupStock).toHaveBeenCalledWith(
        'early-bird-pool',
        'tt-group',
        11,
      );
      expect(inventory.releaseStock).not.toHaveBeenCalled();
    });
  });
});
