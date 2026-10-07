import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
      kind: 'PARTNER' as const,
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
        // Own-seat orders already on the account; 0 unless a test says so.
        count: jest.fn().mockResolvedValue(0),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      // Order creation writes inside an interactive transaction (callback
      // form); the array form is what acceptTransfer uses.
      $transaction: jest.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
      ticket: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn((args) => ({ op: 'ticket.update', args })),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', email: 'user@gmail.com' }),
      },
      orderHistory: {
        create: jest.fn().mockResolvedValue(undefined),
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

  it('creates exactly one seat per ticket, each with its own unguessable token, in the same statement as the order', async () => {
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.createOrder('user-1', validGroupOrderDto);

    const { tickets } = prisma.order.create.mock.calls[0][0].data;
    const seats = tickets.create as { seatIndex: number; token: string }[];
    expect(seats.map((t) => t.seatIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(seats.every((t) => /^[0-9a-f]{32}$/.test(t.token))).toBe(true);
    expect(new Set(seats.map((t) => t.token)).size).toBe(11);
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

  it('charges groupBundleTotalAmount instead of price * quantity when set', async () => {
    // 11 * 2000 would be 22000 — this ticket type overrides it to a flat
    // 23880 (an amount 23880/11 can't land on via any integer per-seat price).
    eventService.findTicketType.mockResolvedValue({
      ...groupTicketType,
      groupBundleTotalAmount: 23880,
    });
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.createOrder('user-1', validGroupOrderDto);

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalAmount: 23880, quantity: 11 }),
      }),
    );
  });

  it('records a CREATED history entry on successful order creation', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    const createdOrder = {
      id: 'order-1',
      registrantName: 'Leader',
      registrantTeam: 'Team',
      registrantLineId: 'leader-line',
      registrantPhone: '0900000000',
      mealPreference: '葷食',
      quantity: 11,
      groupMembers: makeMembers(10),
      companions: null,
    };
    prisma.order.create.mockResolvedValue(createdOrder);

    await service.createOrder('user-1', validGroupOrderDto);

    expect(prisma.orderHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId: 'order-1',
        action: 'CREATED',
        actorUserId: 'user-1',
        actorLabel: 'user@gmail.com',
        after: expect.objectContaining({ registrantName: 'Leader' }),
      }),
    });
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
        { name: 'Only One Filled In', contact: '', mealPreference: '', kind: 'PARTNER' as const },
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

  describe('one own seat per account', () => {
    const individualType = {
      id: 'tt-individual',
      price: 2200,
      fixedQuantity: null,
      maxQuantityPerOrder: 5,
      sessionId: 'session-1',
    };
    const singleType = { ...individualType, id: 'tt-single', maxQuantityPerOrder: null };
    const own = {
      ticketTypeId: 'tt-individual',
      quantity: 1,
      registrantName: '王小明',
      registrantTeam: 'Team',
      registrantLineId: 'buyer-line',
      registrantPhone: '0900000000',
      mealPreference: '葷食',
    };
    const relative = (name: string) => ({
      name,
      relationship: '父母',
      mealPreference: '葷食',
      note: 'n',
    });

    beforeEach(() => {
      eventService.findTicketType.mockResolvedValue(individualType);
      inventory.decrementStock.mockResolvedValue(0);
      prisma.order.create.mockResolvedValue({ id: 'order-new' });
    });

    it('refuses a second own-seat order before touching stock', async () => {
      prisma.order.count.mockResolvedValue(1);

      await expect(service.createOrder('user-1', own)).rejects.toThrow(
        '每個帳號只能有一張本人的票',
      );
      expect(inventory.decrementStock).not.toHaveBeenCalled();
      expect(prisma.order.create).not.toHaveBeenCalled();
    });

    it('counts only live orders that hold a seat for the buyer (not family orders, not cancelled)', async () => {
      await service.createOrder('user-1', own);

      expect(prisma.order.count).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: { in: ['PAID', 'PENDING'] },
          buyingForFamily: false,
        },
      });
    });

    it('lets a buyer who already holds a seat order for family, named as the relatives', async () => {
      prisma.order.count.mockResolvedValue(1);

      await service.createOrder('user-1', {
        ...own,
        quantity: 2,
        buyingForFamily: true,
        companions: [relative('陳大華'), relative('林小美')],
      });

      expect(prisma.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ buyingForFamily: true }),
        }),
      );
      // A family order holds no seat for the buyer, so it takes no lock.
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('refuses a family order whose relative is named as the buyer', async () => {
      await expect(
        service.createOrder('user-1', {
          ...own,
          quantity: 1,
          buyingForFamily: true,
          companions: [relative('王小明')],
        }),
      ).rejects.toThrow('不能和您本人相同');
    });

    it('refuses the same relative listed twice', async () => {
      await expect(
        service.createOrder('user-1', {
          ...own,
          quantity: 3,
          companions: [relative('陳大華'), relative('陳大華')],
        }),
      ).rejects.toThrow('重複');
    });

    it('refuses buyingForFamily on a ticket type that takes no companions', async () => {
      eventService.findTicketType.mockResolvedValue(singleType);

      await expect(
        service.createOrder('user-1', {
          ...own,
          ticketTypeId: 'tt-single',
          buyingForFamily: true,
        }),
      ).rejects.toThrow('不開放幫親友代訂');
      expect(inventory.decrementStock).not.toHaveBeenCalled();
    });

    it('holds under a race: a concurrent order that slips past the early check is refused at the write, and its stock goes back', async () => {
      // The early check sees nothing; by the time this request holds the
      // per-account lock the other request's order has landed.
      prisma.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      await expect(service.createOrder('user-1', own)).rejects.toThrow(
        '每個帳號只能有一張本人的票',
      );

      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(prisma.order.create).not.toHaveBeenCalled();
      expect(inventory.releaseStock).toHaveBeenCalledWith(expect.anything(), 1);
    });

    it('applies to a group bundle too, and refuses before the group claim is even taken', async () => {
      eventService.findTicketType.mockResolvedValue(groupTicketType);
      prisma.order.count.mockResolvedValue(1);

      await expect(
        service.createOrder('user-1', validGroupOrderDto),
      ).rejects.toThrow('每個帳號只能有一張本人的票');

      expect(inventory.claimGroupPurchase).not.toHaveBeenCalled();
      expect(inventory.decrementStock).not.toHaveBeenCalled();
    });

    it('gives the group claim and the stock back when a bundle is refused at the write', async () => {
      eventService.findTicketType.mockResolvedValue(groupTicketType);
      prisma.order.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      await expect(
        service.createOrder('user-1', validGroupOrderDto),
      ).rejects.toThrow('每個帳號只能有一張本人的票');

      expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith(
        'session-1',
        'user-1',
      );
      expect(inventory.releaseStock).toHaveBeenCalled();
    });
  });

  describe('group member identity on update', () => {
    const existingOrder = {
      id: 'order-1',
      userId: 'user-1',
      ticketType: {
        ...groupTicketType,
        session: { startTime: new Date('2099-01-01T00:00:00Z') },
        batch: { saleEndAt: null },
      },
    };

    beforeEach(() => {
      prisma.order.findUnique = jest.fn().mockResolvedValue(existingOrder);
      prisma.order.update = jest.fn().mockResolvedValue(existingOrder);
    });

    it('refuses a named member who is not marked as 夥伴 or 親友 — which is how old orders get filled in', async () => {
      const members = makeMembers(10).map(({ kind: _kind, ...rest }) => rest);

      await expect(
        service.updateGroupMembers('user-1', 'order-1', members as any),
      ).rejects.toThrow('是夥伴還是親友');
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('stores a relative together with whose relative it is', async () => {
      const members = makeMembers(10);
      members[2] = { ...members[2], kind: 'RELATIVE' as any, relativeOfSeat: 1 } as any;

      await service.updateGroupMembers('user-1', 'order-1', members);

      const saved = prisma.order.update.mock.calls[0][0].data.groupMembers;
      expect(saved[2]).toMatchObject({ kind: 'RELATIVE', relativeOfSeat: 1 });
    });
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

    it('records a GROUP_MEMBERS_UPDATED history entry with before/after snapshots', async () => {
      const members = makeMembers(10);
      await service.updateGroupMembers('user-1', 'order-1', members);
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          action: 'GROUP_MEMBERS_UPDATED',
          actorUserId: 'user-1',
          after: expect.objectContaining({ groupMembers: members }),
        }),
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

  describe('updateRegistrantInfo', () => {
    const individualTicketType = {
      id: 'tt-individual',
      fixedQuantity: null,
      maxQuantityPerOrder: null,
      session: { startTime: new Date('2099-01-01T00:00:00Z') },
    };

    const plainOrder = {
      id: 'order-1',
      userId: 'user-1',
      quantity: 1,
      buyingForFamily: false,
      ticketType: individualTicketType,
    };

    const validDto = {
      registrantName: '王小明',
      registrantTeam: 'Team',
      registrantLineId: 'line-id',
      registrantPhone: '0900000000',
      mealPreference: '葷食',
    };

    beforeEach(() => {
      prisma.order.findUnique = jest.fn().mockResolvedValue(plainOrder);
      prisma.order.update = jest.fn().mockResolvedValue({
        ...plainOrder,
        ...validDto,
      });
    });

    it("updates a plain individual order's registrant info", async () => {
      await service.updateRegistrantInfo('user-1', 'order-1', validDto);
      expect(prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: {
          registrantName: '王小明',
          registrantTeam: 'Team',
          registrantLineId: 'line-id',
          registrantPhone: '0900000000',
          mealPreference: '葷食',
        },
      });
    });

    it('rejects when the order belongs to someone else', async () => {
      await expect(
        service.updateRegistrantInfo('someone-else', 'order-1', validDto),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('records a REGISTRANT_INFO_UPDATED history entry with before/after snapshots', async () => {
      await service.updateRegistrantInfo('user-1', 'order-1', validDto);
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          action: 'REGISTRANT_INFO_UPDATED',
          actorUserId: 'user-1',
          actorLabel: 'user@gmail.com',
          before: expect.objectContaining({ registrantName: undefined }),
          after: expect.objectContaining({ registrantName: '王小明' }),
        }),
      });
    });

    it('rejects editing a group ticket order (use updateGroupMembers instead)', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...plainOrder,
        ticketType: {
          ...groupTicketType,
          session: individualTicketType.session,
        },
      });
      await expect(
        service.updateRegistrantInfo('user-1', 'order-1', validDto),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects editing once the event has already happened', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...plainOrder,
        ticketType: {
          ...individualTicketType,
          session: { startTime: new Date('2000-01-01T00:00:00Z') },
        },
      });
      await expect(
        service.updateRegistrantInfo('user-1', 'order-1', validDto),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('rejects a non-Chinese registrantName when not buying for family', async () => {
      await expect(
        service.updateRegistrantInfo('user-1', 'order-1', {
          ...validDto,
          registrantName: 'John',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    describe('multi-quantity individual ticket with companions', () => {
      const familyOrder = {
        id: 'order-2',
        userId: 'user-1',
        quantity: 3,
        buyingForFamily: false,
        ticketType: {
          ...individualTicketType,
          id: 'tt-family',
          maxQuantityPerOrder: 5,
        },
      };

      const companions = [
        {
          name: '陳小華',
          relationship: '父母',
          mealPreference: '葷食',
          note: '無',
        },
        {
          name: '林小美',
          relationship: '子女',
          mealPreference: '素食',
          note: '無',
        },
      ];

      beforeEach(() => {
        prisma.order.findUnique.mockResolvedValue(familyOrder);
        prisma.order.update.mockResolvedValue({ ...familyOrder, companions });
      });

      it('updates registrant info and companions together', async () => {
        await service.updateRegistrantInfo('user-1', 'order-2', {
          ...validDto,
          companions,
        });
        expect(prisma.order.update).toHaveBeenCalledWith({
          where: { id: 'order-2' },
          data: expect.objectContaining({ companions }),
        });
      });

      it('rejects a companions array of the wrong length', async () => {
        await expect(
          service.updateRegistrantInfo('user-1', 'order-2', {
            ...validDto,
            companions: [companions[0]],
          }),
        ).rejects.toThrow(BadRequestException);
      });

      it('rejects a companion name that is not Chinese characters only', async () => {
        await expect(
          service.updateRegistrantInfo('user-1', 'order-2', {
            ...validDto,
            companions: [companions[0], { ...companions[1], name: 'John' }],
          }),
        ).rejects.toThrow(BadRequestException);
      });
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

    it('records a CANCELLED history entry', async () => {
      const order = makeCancellableOrder(groupTicketType);
      prisma.order.findUnique = jest.fn().mockResolvedValue(order);
      prisma.order.findUniqueOrThrow = jest
        .fn()
        .mockResolvedValue({ ...order, status: 'CANCELLED' });
      await service.cancelOrder('user-1', 'order-1');
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          action: 'CANCELLED',
          actorUserId: 'user-1',
          before: expect.objectContaining({ status: 'PAID' }),
          after: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      });
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

  describe('listMyOrders', () => {
    it('flags each order with isFirstWave, computed the same way createTransfer enforces it', async () => {
      prisma.order.findMany = jest.fn().mockResolvedValue([
        {
          id: 'order-1',
          ticketType: { sessionId: 'session-1', batchId: 'batch-1' },
          transfers: [],
          tickets: [],
        },
        {
          id: 'order-2',
          ticketType: { sessionId: 'session-1', batchId: 'batch-2' },
          transfers: [],
          tickets: [],
        },
      ]);
      prisma.saleBatch = {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'batch-1' }, { id: 'batch-2' }]),
      };

      const result = await service.listMyOrders('user-1');

      expect(result.find((o: any) => o.id === 'order-1')?.isFirstWave).toBe(true);
      expect(result.find((o: any) => o.id === 'order-2')?.isFirstWave).toBe(false);
    });
  });

  describe('listMyOrders seats', () => {
    it("gives the owner one QR entry per seat, named as the door will see it, and drops the raw ticket rows", async () => {
      prisma.saleBatch = { findMany: jest.fn().mockResolvedValue([{ id: 'batch-1' }]) };
      prisma.order.findMany = jest.fn().mockResolvedValue([
        {
          id: 'order-1',
          registrantName: '王小明',
          registrantTeam: '里歐',
          mealPreference: '葷食',
          groupLeaderName: null,
          groupMembers: null,
          buyingForFamily: false,
          companions: [{ name: '王媽媽', relationship: '父母', mealPreference: '素食', note: 'n' }],
          ticketType: {
            sessionId: 'session-1',
            batchId: 'batch-1',
            fixedQuantity: null,
            sharedStockKey: null,
            batch: { stockSweepDone: false },
          },
          transfers: [],
          tickets: [
            { id: 't0', seatIndex: 0, token: 'a'.repeat(32), checkedInAt: null },
            { id: 't1', seatIndex: 1, token: 'b'.repeat(32), checkedInAt: null },
          ],
        },
      ]);

      const [order] = await service.listMyOrders('user-1');

      expect(order).not.toHaveProperty('tickets');
      expect(order.seats).toEqual([
        { id: 't0', seatIndex: 0, token: 'a'.repeat(32), checkedInAt: null, released: false, holder: { name: '王小明', role: 'SELF', mealPreference: '葷食', team: '里歐', relation: null } },
        { id: 't1', seatIndex: 1, token: 'b'.repeat(32), checkedInAt: null, released: false, holder: { name: '王媽媽', role: 'COMPANION', mealPreference: '素食', team: '里歐', relation: null } },
      ]);
    });
  });

  describe('createTransfer', () => {
    function makeOrder(batchId: string) {
      return {
        id: 'order-1',
        userId: 'user-1',
        status: 'PAID',
        ticketType: { sessionId: 'session-1', batchId, batch: {} },
      };
    }

    beforeEach(() => {
      prisma.order.findUnique = jest.fn();
      prisma.saleBatch = { findMany: jest.fn() };
      prisma.ticketTransfer = {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'transfer-1' }),
      };
      prisma.user.findUnique = jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(
          where.id === 'user-1'
            ? { id: 'user-1', email: 'user@gmail.com' }
            : { id: 'user-2', email: 'friend@gmail.com' },
        ),
      );
    });

    it('rejects a transfer request for a 第一波 (earliest) batch order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder('batch-1'));
      // batch-1 created first -> it's the earliest, i.e. 第一波.
      prisma.saleBatch.findMany.mockResolvedValue([
        { id: 'batch-1' },
        { id: 'batch-2' },
      ]);

      await expect(
        service.createTransfer('user-1', 'order-1', 'friend@gmail.com'),
      ).rejects.toThrow('第一波票券已停止轉讓功能');
      expect(prisma.ticketTransfer.create).not.toHaveBeenCalled();
    });

    it('allows a transfer request for a later-wave batch order', async () => {
      prisma.order.findUnique.mockResolvedValue(makeOrder('batch-2'));
      prisma.saleBatch.findMany.mockResolvedValue([
        { id: 'batch-1' },
        { id: 'batch-2' },
      ]);

      await service.createTransfer('user-1', 'order-1', 'friend@gmail.com');

      expect(prisma.ticketTransfer.create).toHaveBeenCalledWith({
        data: { orderId: 'order-1', fromUserId: 'user-1', toUserId: 'user-2' },
      });
    });

    it('rejects a new transfer once the batch transferEndAt has passed', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...makeOrder('batch-2'),
        ticketType: {
          sessionId: 'session-1',
          batchId: 'batch-2',
          batch: { transferEndAt: new Date(Date.now() - 1000) },
        },
      });
      prisma.saleBatch.findMany.mockResolvedValue([
        { id: 'batch-1' },
        { id: 'batch-2' },
      ]);

      await expect(
        service.createTransfer('user-1', 'order-1', 'friend@gmail.com'),
      ).rejects.toThrow('轉讓功能已截止');
      expect(prisma.ticketTransfer.create).not.toHaveBeenCalled();
    });

    it('still allows a new transfer before transferEndAt', async () => {
      prisma.order.findUnique.mockResolvedValue({
        ...makeOrder('batch-2'),
        ticketType: {
          sessionId: 'session-1',
          batchId: 'batch-2',
          batch: { transferEndAt: new Date(Date.now() + 60_000) },
        },
      });
      prisma.saleBatch.findMany.mockResolvedValue([
        { id: 'batch-1' },
        { id: 'batch-2' },
      ]);

      await service.createTransfer('user-1', 'order-1', 'friend@gmail.com');

      expect(prisma.ticketTransfer.create).toHaveBeenCalled();
    });
  });

  describe('acceptTransfer', () => {
    it("emails the admin team with the recipient's reviewed/edited notice details once accepted", async () => {
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
        }),
        update: jest.fn(),
      };
      prisma.$transaction = jest
        .fn()
        .mockResolvedValue([null, { id: 'order-1', userId: 'user-2' }]);

      await service.acceptTransfer('user-2', 'transfer-1', {
        fromName: '王小明（已編輯）',
        toName: '陳小華',
        mealPreference: '葷食',
        buyingForFamily: false,
      });

      expect(emailService.sendTransferAdminNotice).toHaveBeenCalledWith({
        fromName: '王小明（已編輯）',
        toName: '陳小華',
        mealPreference: '葷食',
        buyingForFamily: false,
      });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          action: 'TRANSFER_ACCEPTED',
          actorUserId: 'user-2',
          before: expect.objectContaining({ userId: undefined }),
          after: expect.objectContaining({ userId: 'user-2' }),
        }),
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
        }),
        update: jest.fn(),
      };
      prisma.$transaction = jest
        .fn()
        .mockResolvedValue([null, { id: 'order-1', userId: 'user-2' }]);
      emailService.sendTransferAdminNotice.mockRejectedValue(
        new Error('resend down'),
      );

      const result = await service.acceptTransfer('user-2', 'transfer-1', {
        fromName: '王小明',
        toName: '陳小華',
        mealPreference: '葷食',
        buyingForFamily: false,
      });
      expect(result).toEqual({ id: 'order-1', userId: 'user-2' });
    });

    /**
     * The one-bundle-per-session cap lives in a Redis claim keyed by
     * (session, owner) with no TTL, so a transfer that doesn't move it lets
     * the recipient accept bundle after bundle while the sender stays locked
     * out of buying another one forever.
     */
    describe('group-bundle purchase claim handoff', () => {
      const notice = {
        fromName: '王小明',
        toName: '陳小華',
        mealPreference: '葷食',
        buyingForFamily: false,
      };

      function mockPendingTransfer(fixedQuantity: number | null) {
        prisma.ticketTransfer = {
          findUnique: jest.fn().mockResolvedValue({
            id: 'transfer-1',
            orderId: 'order-1',
            toUserId: 'user-2',
            status: 'PENDING',
            order: {
              status: 'PAID',
              userId: 'user-1',
              ticketType: {
                id: 'tt-group',
                sessionId: 'session-1',
                fixedQuantity,
                batch: {},
              },
            },
          }),
          update: jest.fn(),
        };
        prisma.$transaction = jest
          .fn()
          .mockResolvedValue([null, { id: 'order-1', userId: 'user-2' }]);
      }

      it("stakes the recipient's claim and frees the previous owner's", async () => {
        mockPendingTransfer(11);

        await service.acceptTransfer('user-2', 'transfer-1', notice);

        expect(inventory.claimGroupPurchase).toHaveBeenCalledWith(
          'session-1',
          'user-2',
        );
        expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith(
          'session-1',
          'user-1',
        );
      });

      it('refuses a recipient who already holds a bundle for that session, leaving ownership untouched', async () => {
        mockPendingTransfer(11);
        inventory.claimGroupPurchase.mockResolvedValue(false);

        await expect(
          service.acceptTransfer('user-2', 'transfer-1', notice),
        ).rejects.toThrow(BadRequestException);

        expect(prisma.$transaction).not.toHaveBeenCalled();
        // The sender still owns the bundle, so their claim must stand.
        expect(inventory.releaseGroupPurchaseClaim).not.toHaveBeenCalled();
      });

      it("gives the recipient's claim back if the ownership change fails", async () => {
        mockPendingTransfer(11);
        prisma.$transaction.mockRejectedValue(new Error('db down'));

        await expect(
          service.acceptTransfer('user-2', 'transfer-1', notice),
        ).rejects.toThrow('db down');

        expect(inventory.releaseGroupPurchaseClaim).toHaveBeenCalledWith(
          'session-1',
          'user-2',
        );
        expect(inventory.releaseGroupPurchaseClaim).not.toHaveBeenCalledWith(
          'session-1',
          'user-1',
        );
      });

      it("gives every seat a fresh QR token in the same transaction as the ownership change", async () => {
        mockPendingTransfer(null);
        prisma.ticket.findMany.mockResolvedValue([{ id: 'seat-a' }, { id: 'seat-b' }]);

        await service.acceptTransfer('user-2', 'transfer-1', notice);

        const ops = prisma.$transaction.mock.calls[0][0];
        const seatOps = ops.filter((op: any) => op?.op === 'ticket.update');
        expect(seatOps.map((op: any) => op.args.where.id)).toEqual(['seat-a', 'seat-b']);
        const tokens = seatOps.map((op: any) => op.args.data.token);
        expect(tokens.every((t: string) => /^[0-9a-f]{32}$/.test(t))).toBe(true);
        expect(new Set(tokens).size).toBe(2);
      });

      it('rotates no tokens when the recipient is turned away', async () => {
        mockPendingTransfer(11);
        inventory.claimGroupPurchase.mockResolvedValue(false);

        await expect(
          service.acceptTransfer('user-2', 'transfer-1', notice),
        ).rejects.toThrow(BadRequestException);
        expect(prisma.ticket.update).not.toHaveBeenCalled();
      });

      it('leaves claims alone entirely for a non-group order', async () => {
        mockPendingTransfer(null);

        await service.acceptTransfer('user-2', 'transfer-1', notice);

        expect(inventory.claimGroupPurchase).not.toHaveBeenCalled();
        expect(inventory.releaseGroupPurchaseClaim).not.toHaveBeenCalled();
      });
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

    // None may equal baseDto's buyer (王小明): extra seats are for relatives, named as themselves.
    const CHINESE_NAMES = ['陳小華', '林小美', '張小強', '李小龍'];

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
