import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { recordOrderHistory } from '../order/order-history';
import { isSeatReleased, seatHolder, type SeatHolder } from './ticket-seats';

/**
 * Door status of one seat, in precedence order: an order that isn't PAID
 * (cancelled) or a seat the stock sweep gave away is refused regardless of
 * anything else; only then does "already in" vs "can come in" matter.
 */
export type SeatStatus = 'ORDER_NOT_ACTIVE' | 'SEAT_RELEASED' | 'CHECKED_IN' | 'VALID';

export type CheckInResult = 'CHECKED_IN' | 'ALREADY_CHECKED_IN' | 'ORDER_NOT_ACTIVE' | 'SEAT_RELEASED';

const TICKET_INCLUDE = {
  order: {
    include: {
      user: { select: { email: true } },
      ticketType: {
        include: { batch: true, session: { include: { event: true } } },
      },
    },
  },
} as const;

/** Search is capped so a one-character query can't dump the whole guest list at once. */
const MAX_SEARCH_ORDERS = 20;

type TicketRow = {
  id: string;
  seatIndex: number;
  checkedInAt: Date | null;
  checkedInBy: string | null;
};

type OrderRow = Parameters<typeof seatHolder>[0] & {
  id: string;
  status: string;
  quantity: number;
  registrantTeam: string;
  registrantPhone: string;
  groupLeaderPhone: string | null;
  user: { email: string };
  ticketType: Parameters<typeof seatHolder>[0]['ticketType'] & {
    name: string;
    session: { venue: string; startTime: Date; event: { name: string } };
  };
};

/** Team label for orders that somehow have none — never silently dropped from the roster. */
export const UNKNOWN_TEAM = '未填寫';

export interface RosterTeam {
  team: string;
  total: number;
  checkedIn: number;
  seats: SeatView[];
}

export interface SeatView {
  id: string;
  seatIndex: number;
  seatCount: number;
  holder: SeatHolder;
  status: SeatStatus;
  checkedInAt: Date | null;
  checkedInBy: string | null;
  orderId: string;
  ticketTypeName: string;
  buyerEmail: string;
  team: string;
}

export function seatStatus(order: OrderRow, ticket: TicketRow): SeatStatus {
  if (order.status !== 'PAID') return 'ORDER_NOT_ACTIVE';
  if (isSeatReleased(order, ticket.seatIndex)) return 'SEAT_RELEASED';
  if (ticket.checkedInAt) return 'CHECKED_IN';
  return 'VALID';
}

function toView(order: OrderRow, ticket: TicketRow): SeatView {
  return {
    id: ticket.id,
    seatIndex: ticket.seatIndex,
    seatCount: order.quantity,
    holder: seatHolder(order, ticket.seatIndex),
    status: seatStatus(order, ticket),
    checkedInAt: ticket.checkedInAt,
    checkedInBy: ticket.checkedInBy,
    orderId: order.id,
    ticketTypeName: order.ticketType.name,
    buyerEmail: order.user.email,
    team: order.registrantTeam,
  };
}

@Injectable()
export class CheckinService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadTicket(where: { id: string } | { token: string }) {
    const ticket = await this.prisma.ticket.findUnique({
      where,
      include: TICKET_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    return ticket as unknown as TicketRow & { order: OrderRow };
  }

  /** What a scanned QR resolves to. Read-only — staff confirm before anything is recorded. */
  async scan(token: string): Promise<SeatView> {
    const ticket = await this.loadTicket({ token });
    return toView(ticket.order, ticket);
  }

  /**
   * Records a seat as in. The write is conditional on checkedInAt still being
   * null — two scanners hitting the same QR at the same moment (or a
   * forwarded screenshot racing the real holder) get exactly one success;
   * the other sees who got there first and when. Refusals come back as a
   * result code rather than an exception so the door screen can say why.
   */
  async checkIn(ticketId: string, staffLabel: string) {
    const ticket = await this.loadTicket({ id: ticketId });
    const status = seatStatus(ticket.order, ticket);
    if (status === 'ORDER_NOT_ACTIVE' || status === 'SEAT_RELEASED') {
      return { result: status as CheckInResult, ticket: toView(ticket.order, ticket) };
    }

    const checkedInAt = new Date();
    const { count } = await this.prisma.ticket.updateMany({
      where: { id: ticketId, checkedInAt: null },
      data: { checkedInAt, checkedInBy: staffLabel },
    });
    if (count === 0) {
      const current = await this.loadTicket({ id: ticketId });
      return {
        result: 'ALREADY_CHECKED_IN' as CheckInResult,
        ticket: toView(current.order, current),
      };
    }

    await recordOrderHistory(this.prisma, {
      orderId: ticket.order.id,
      action: 'CHECKED_IN',
      actorLabel: staffLabel,
      after: { seatIndex: ticket.seatIndex, name: seatHolder(ticket.order, ticket.seatIndex).name },
    });

    return {
      result: 'CHECKED_IN' as CheckInResult,
      ticket: toView(ticket.order, { ...ticket, checkedInAt, checkedInBy: staffLabel }),
    };
  }

  /** For a mis-tap at the door. Conditional for the same reason checkIn is. */
  async undoCheckIn(ticketId: string, staffLabel: string) {
    const ticket = await this.loadTicket({ id: ticketId });
    const { count } = await this.prisma.ticket.updateMany({
      where: { id: ticketId, checkedInAt: { not: null } },
      data: { checkedInAt: null, checkedInBy: null },
    });
    if (count > 0) {
      await recordOrderHistory(this.prisma, {
        orderId: ticket.order.id,
        action: 'CHECK_IN_UNDONE',
        actorLabel: staffLabel,
        before: { seatIndex: ticket.seatIndex, checkedInAt: ticket.checkedInAt, checkedInBy: ticket.checkedInBy },
      });
    }
    const current = await this.loadTicket({ id: ticketId });
    return toView(current.order, current);
  }

  /**
   * Every seat, with its order. Search and the headcount both need names that
   * live inside JSON (group members, companions), which Postgres can't
   * substring-match through Prisma — so this loads everything and filters in
   * memory. Fine at this event's scale (hundreds of orders); revisit before
   * reusing it for something with tens of thousands.
   */
  private async allOrdersWithSeats() {
    const orders = await this.prisma.order.findMany({
      include: {
        tickets: { orderBy: { seatIndex: 'asc' } },
        user: { select: { email: true } },
        ticketType: {
          include: { batch: true, session: { include: { event: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return orders as unknown as (OrderRow & { tickets: TicketRow[] })[];
  }

  /**
   * Manual lookup for whoever can't show a QR (dead phone, no signal). A match
   * on anything order-level (email, phone, buyer/leader name) returns every
   * seat on that order; a match on one member's or companion's name returns
   * the whole order too, since staff usually want to see the party together.
   */
  async search(query: string): Promise<SeatView[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const includes = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q);

    const matches = (await this.allOrdersWithSeats()).filter(
      (order) =>
        includes(order.user.email) ||
        includes(order.registrantName) ||
        includes(order.registrantPhone) ||
        includes(order.groupLeaderName) ||
        includes(order.groupLeaderPhone) ||
        order.tickets.some((t) => includes(seatHolder(order, t.seatIndex).name)),
    );

    return matches
      .slice(0, MAX_SEARCH_ORDERS)
      .flatMap((order) => order.tickets.map((t) => toView(order, t)));
  }

  /**
   * Every seat that can actually come in, grouped by the order's
   * registrantTeam — the same field the admin export and team stats use.
   * Group members and companions don't have a team of their own, so each
   * seat is filed under the buyer's. Cancelled orders and released seats
   * aren't sold tickets any more and are left out, so a team's total
   * matches what the door can really expect.
   */
  async roster(): Promise<RosterTeam[]> {
    const teams = new Map<string, RosterTeam>();
    for (const order of await this.allOrdersWithSeats()) {
      const team = order.registrantTeam?.trim() || UNKNOWN_TEAM;
      for (const ticket of order.tickets) {
        const view = toView(order, ticket);
        if (view.status !== 'VALID' && view.status !== 'CHECKED_IN') continue;
        const entry = teams.get(team) ?? { team, total: 0, checkedIn: 0, seats: [] };
        entry.total++;
        if (view.status === 'CHECKED_IN') entry.checkedIn++;
        entry.seats.push(view);
        teams.set(team, entry);
      }
    }
    return [...teams.values()];
  }

  /** Headcount: seats that can actually come in, and how many already have. */
  async stats() {
    let total = 0;
    let checkedIn = 0;
    for (const order of await this.allOrdersWithSeats()) {
      for (const ticket of order.tickets) {
        const status = seatStatus(order, ticket);
        if (status === 'VALID' || status === 'CHECKED_IN') total++;
        if (status === 'CHECKED_IN') checkedIn++;
      }
    }
    return { total, checkedIn };
  }

  /**
   * What the no-login share page shows — the link a group leader forwards
   * to a member. Holding the token is the only credential, so it reveals the
   * seat's own name, its team and how it relates to the group ("夥伴",
   * "<夥伴>的親友"), and the event details — never the buyer's email or phone.
   */
  async publicTicket(token: string) {
    const ticket = await this.loadTicket({ token });
    const { order } = ticket;
    const holder = seatHolder(order, ticket.seatIndex);
    return {
      holderName: holder.name,
      role: holder.role,
      team: holder.team,
      relation: holder.relation,
      seatIndex: ticket.seatIndex,
      seatCount: order.quantity,
      status: seatStatus(order, ticket),
      checkedInAt: ticket.checkedInAt,
      ticketTypeName: order.ticketType.name,
      eventName: order.ticketType.session.event.name,
      venue: order.ticketType.session.venue,
      startTime: order.ticketType.session.startTime,
    };
  }
}
