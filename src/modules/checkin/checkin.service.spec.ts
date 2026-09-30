import { NotFoundException } from '@nestjs/common';
import { CheckinService } from './checkin.service';

function makeOrder(overrides: Record<string, any> = {}) {
  return {
    id: 'order-1',
    status: 'PAID',
    quantity: 3,
    registrantName: '王小明',
    registrantTeam: '子揚',
    registrantPhone: '0912345678',
    mealPreference: '葷食',
    groupLeaderName: null,
    groupLeaderPhone: null,
    groupMembers: null,
    companions: [
      { name: '王媽媽', relationship: '父母', mealPreference: '素食', note: 'n' },
      { name: '王妹妹', relationship: '兄弟姊妹', mealPreference: '葷食', note: 'n' },
    ],
    buyingForFamily: false,
    user: { email: 'ming@gmail.com' },
    ticketType: {
      name: '單人早鳥票',
      fixedQuantity: null,
      sharedStockKey: null,
      batch: { stockSweepDone: false },
      session: { venue: '會場', startTime: new Date('2026-12-01T10:00:00Z'), event: { name: 'TS年度盛會' } },
    },
    ...overrides,
  };
}

function makeTicket(order: any, seatIndex: number, extra: Record<string, any> = {}) {
  return { id: `t-${order.id}-${seatIndex}`, seatIndex, token: `tok-${seatIndex}`, checkedInAt: null, checkedInBy: null, order, ...extra };
}

describe('CheckinService', () => {
  let prisma: any;
  let service: CheckinService;

  beforeEach(() => {
    prisma = {
      ticket: { findUnique: jest.fn(), updateMany: jest.fn() },
      order: { findMany: jest.fn() },
      orderHistory: { create: jest.fn().mockResolvedValue(undefined) },
    };
    service = new CheckinService(prisma);
  });

  describe('scan', () => {
    it('resolves a QR token to the seat holder by name, without recording anything', async () => {
      prisma.ticket.findUnique.mockResolvedValue(makeTicket(makeOrder(), 1));

      const view = await service.scan('tok-1');

      expect(prisma.ticket.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { token: 'tok-1' } }),
      );
      expect(view).toMatchObject({ status: 'VALID', holder: { name: '王媽媽', role: 'COMPANION' }, seatCount: 3 });
      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    });

    it('an unknown QR is a 404, not a crash', async () => {
      prisma.ticket.findUnique.mockResolvedValue(null);
      await expect(service.scan('garbage')).rejects.toThrow(NotFoundException);
    });
  });

  describe('checkIn', () => {
    it('records the seat once, conditionally, with the staff name, and writes history', async () => {
      prisma.ticket.findUnique.mockResolvedValue(makeTicket(makeOrder(), 0));
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });

      const { result, ticket } = await service.checkIn('t-order-1-0', '小美');

      expect(result).toBe('CHECKED_IN');
      const { where, data } = prisma.ticket.updateMany.mock.calls[0][0];
      expect(where).toEqual({ id: 't-order-1-0', checkedInAt: null });
      expect(data.checkedInBy).toBe('小美');
      expect(ticket).toMatchObject({ status: 'CHECKED_IN', checkedInBy: '小美' });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-1',
          action: 'CHECKED_IN',
          actorUserId: null,
          actorLabel: '小美',
          after: { seatIndex: 0, name: '王小明' },
        }),
      });
    });

    it('when another scanner got there first, reports who and when instead of checking in twice', async () => {
      const order = makeOrder();
      const firstAt = new Date('2026-12-01T09:31:00Z');
      prisma.ticket.findUnique
        .mockResolvedValueOnce(makeTicket(order, 0))
        .mockResolvedValueOnce(makeTicket(order, 0, { checkedInAt: firstAt, checkedInBy: '阿強' }));
      prisma.ticket.updateMany.mockResolvedValue({ count: 0 });

      const { result, ticket } = await service.checkIn('t-order-1-0', '小美');

      expect(result).toBe('ALREADY_CHECKED_IN');
      expect(ticket).toMatchObject({ checkedInAt: firstAt, checkedInBy: '阿強' });
      expect(prisma.orderHistory.create).not.toHaveBeenCalled();
    });

    it('refuses a seat on a cancelled order without writing', async () => {
      prisma.ticket.findUnique.mockResolvedValue(makeTicket(makeOrder({ status: 'CANCELLED' }), 0));

      const { result } = await service.checkIn('t-order-1-0', '小美');

      expect(result).toBe('ORDER_NOT_ACTIVE');
      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a blank group seat the stock sweep already gave away', async () => {
      const order = makeOrder({
        quantity: 11,
        companions: null,
        groupLeaderName: '主揪',
        groupMembers: [{ name: '', contact: '', mealPreference: '' }],
        ticketType: { ...makeOrder().ticketType, fixedQuantity: 11, sharedStockKey: 'pool', batch: { stockSweepDone: true } },
      });
      prisma.ticket.findUnique.mockResolvedValue(makeTicket(order, 1));

      const { result } = await service.checkIn('t-order-1-1', '小美');

      expect(result).toBe('SEAT_RELEASED');
      expect(prisma.ticket.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('undoCheckIn', () => {
    it('clears a check-in conditionally and records who undid it', async () => {
      const order = makeOrder();
      const at = new Date();
      prisma.ticket.findUnique
        .mockResolvedValueOnce(makeTicket(order, 0, { checkedInAt: at, checkedInBy: '小美' }))
        .mockResolvedValueOnce(makeTicket(order, 0));
      prisma.ticket.updateMany.mockResolvedValue({ count: 1 });

      const view = await service.undoCheckIn('t-order-1-0', '阿強');

      expect(prisma.ticket.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 't-order-1-0', checkedInAt: { not: null } },
        data: { checkedInAt: null, checkedInBy: null },
      });
      expect(prisma.orderHistory.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'CHECK_IN_UNDONE',
          actorLabel: '阿強',
          before: { seatIndex: 0, checkedInAt: at, checkedInBy: '小美' },
        }),
      });
      expect(view.status).toBe('VALID');
    });
  });

  describe('search and stats', () => {
    const family = makeOrder();
    const other = makeOrder({ id: 'order-2', registrantName: '陳大文', registrantPhone: '0988000111', companions: null, quantity: 1, user: { email: 'chan@gmail.com' } });
    const cancelled = makeOrder({ id: 'order-3', status: 'CANCELLED', registrantName: '林取消', companions: null, quantity: 1, user: { email: 'lin@gmail.com' } });
    const withSeats = (o: any, checked: number[] = []) => ({
      ...o,
      tickets: Array.from({ length: o.quantity }, (_, i) =>
        makeTicket(o, i, checked.includes(i) ? { checkedInAt: new Date(), checkedInBy: 'x' } : {}),
      ),
    });

    beforeEach(() => {
      prisma.order.findMany.mockResolvedValue([withSeats(family, [0]), withSeats(other), withSeats(cancelled)]);
    });

    it("finds a companion by a name that only exists inside the order's JSON, returning the whole party", async () => {
      const seats = await service.search('王妹');
      expect(seats.map((s) => s.holder.name)).toEqual(['王小明', '王媽媽', '王妹妹']);
    });

    it('finds by phone and by email, case-insensitively', async () => {
      expect((await service.search('0988')).map((s) => s.orderId)).toEqual(['order-2']);
      expect((await service.search('CHAN@')).map((s) => s.orderId)).toEqual(['order-2']);
    });

    it('a blank query returns nothing rather than the whole guest list', async () => {
      expect(await service.search('   ')).toEqual([]);
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('still shows a cancelled order when searched, flagged so staff can explain', async () => {
      const [seat] = await service.search('林取消');
      expect(seat.status).toBe('ORDER_NOT_ACTIVE');
    });

    it('headcount counts only seats that can come in, and how many have', async () => {
      await expect(service.stats()).resolves.toEqual({ total: 4, checkedIn: 1 });
    });
  });

  describe('publicTicket', () => {
    it("shows the seat's own name and the event, never the buyer's email, phone or team", async () => {
      prisma.ticket.findUnique.mockResolvedValue(makeTicket(makeOrder(), 2));

      const view = await service.publicTicket('tok-2');

      expect(view).toMatchObject({ holderName: '王妹妹', eventName: 'TS年度盛會', status: 'VALID', seatCount: 3 });
      const serialized = JSON.stringify(view);
      for (const secret of ['ming@gmail.com', '0912345678', '子揚', '王小明']) {
        expect(serialized).not.toContain(secret);
      }
    });
  });
});
