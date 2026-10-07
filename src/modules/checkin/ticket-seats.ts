import { randomBytes } from 'crypto';
import type { GroupMember } from '../order/types/group-member';
import type { Companion } from '../order/types/companion';

/**
 * 128 random bits as 32 hex chars — the same shape the backfill migration
 * produces from gen_random_uuid(), so old and new tickets are
 * indistinguishable. This is what a QR code carries, so it must never be
 * derived from anything guessable (order id, seat index, email...).
 */
export function newTicketToken(): string {
  return randomBytes(16).toString('hex');
}

/** One `{ seatIndex, token }` per unit of quantity, for a nested create. */
export function ticketSeatsFor(quantity: number) {
  return Array.from({ length: quantity }, (_, seatIndex) => ({
    seatIndex,
    token: newTicketToken(),
  }));
}

export type SeatRole = 'LEADER' | 'MEMBER' | 'SELF' | 'COMPANION';

export interface SeatHolder {
  /** Null when that seat's name was never filled in. */
  name: string | null;
  role: SeatRole;
  mealPreference: string | null;
  /** The order's team (體系); the same for every seat, since members have none of their own. */
  team: string | null;
  /**
   * Group seats only: how this person relates to the group — "主揪", "夥伴",
   * or "<夥伴>的親友". Null on a member whose marking was never filled in
   * (orders from before it was asked) and on non-group seats.
   */
  relation: string | null;
}

/** The order fields seat mapping reads — a structural subset of Prisma's Order. */
export interface SeatOrder {
  registrantName: string;
  registrantTeam: string;
  mealPreference: string;
  groupLeaderName: string | null;
  groupMembers: unknown;
  companions: unknown;
  buyingForFamily: boolean;
  ticketType: {
    fixedQuantity: number | null;
    sharedStockKey: string | null;
    batch: { stockSweepDone: boolean };
  };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Who a seat belongs to. The two "extra people" models map differently —
 * see CLAUDE.md "Companions vs. group members":
 *
 * - Group bundle (fixedQuantity set): seat 0 is the leader, seats 1..n are
 *   groupMembers[0..n-1]. Members may still be the legacy plain-string shape.
 * - Individual, buyingForFamily false: seat 0 is the buyer (registrant*),
 *   seats 1..n are companions[0..n-1].
 * - Individual, buyingForFamily true: the buyer holds no ticket at all —
 *   seat i is companions[i]. Treating seat 0 as the buyer here would admit
 *   someone who isn't going and turn away a family member who is.
 */
export function seatHolder(order: SeatOrder, seatIndex: number): SeatHolder {
  const team = blankToNull(order.registrantTeam);
  if (order.ticketType.fixedQuantity != null) {
    const members = Array.isArray(order.groupMembers)
      ? (order.groupMembers as (GroupMember | string)[])
      : [];
    if (seatIndex === 0) {
      return {
        name: groupSeatName(order, members, 0),
        role: 'LEADER',
        mealPreference: blankToNull(order.mealPreference),
        team,
        relation: '主揪',
      };
    }
    const member = members[seatIndex - 1];
    if (typeof member === 'string') {
      return { name: blankToNull(member), role: 'MEMBER', mealPreference: null, team, relation: null };
    }
    return {
      name: blankToNull(member?.name),
      role: 'MEMBER',
      mealPreference: blankToNull(member?.mealPreference),
      team,
      relation: memberRelation(order, members, member),
    };
  }

  const companions = Array.isArray(order.companions)
    ? (order.companions as Companion[])
    : [];
  if (order.buyingForFamily) {
    const companion = companions[seatIndex];
    return {
      name: blankToNull(companion?.name),
      role: 'COMPANION',
      mealPreference: blankToNull(companion?.mealPreference),
      team,
      relation: null,
    };
  }
  if (seatIndex === 0) {
    return {
      name: blankToNull(order.registrantName),
      role: 'SELF',
      mealPreference: blankToNull(order.mealPreference),
      team,
      relation: null,
    };
  }
  const companion = companions[seatIndex - 1];
  return {
    name: blankToNull(companion?.name),
    role: 'COMPANION',
    mealPreference: blankToNull(companion?.mealPreference),
    team,
    relation: null,
  };
}

/** The name on a group seat: 0 is the leader, i >= 1 is members[i - 1] (either stored shape). */
function groupSeatName(
  order: Pick<SeatOrder, 'groupLeaderName' | 'registrantName'>,
  members: (GroupMember | string)[],
  seatIndex: number,
): string | null {
  if (seatIndex === 0) {
    return blankToNull(order.groupLeaderName) ?? blankToNull(order.registrantName);
  }
  const member = members[seatIndex - 1];
  return blankToNull(typeof member === 'string' ? member : member?.name);
}

/** "夥伴", "<partner>的親友", or null when this member was never marked. */
function memberRelation(
  order: Pick<SeatOrder, 'groupLeaderName' | 'registrantName'>,
  members: (GroupMember | string)[],
  member: GroupMember | undefined,
): string | null {
  if (member?.kind === 'PARTNER') return '夥伴';
  if (member?.kind !== 'RELATIVE') return null;
  const owner =
    typeof member.relativeOfSeat === 'number'
      ? groupSeatName(order, members, member.relativeOfSeat)
      : null;
  return owner ? `${owner}的親友` : '親友';
}

/**
 * How group seat `seatIndex` (1..n, a member) relates to the group, for
 * callers that have the order's own fields but not the whole ticket type —
 * the Excel export. Same answer as `seatHolder(...).relation`.
 */
export function groupMemberRelationAt(
  order: Pick<SeatOrder, 'groupLeaderName' | 'registrantName' | 'groupMembers'>,
  seatIndex: number,
): string | null {
  const members = Array.isArray(order.groupMembers)
    ? (order.groupMembers as (GroupMember | string)[])
    : [];
  const member = members[seatIndex - 1];
  return typeof member === 'string' ? null : memberRelation(order, members, member);
}

/**
 * True when this seat has been handed back to the stock pool and resold, so
 * whoever shows up with its QR must be turned away. Mirrors exactly what
 * StockSweepService does when a wave closes: on a shared-pool group ticket
 * type, every group member left blank has its seat released to the pool
 * (the leader's seat, 0, never is). A blank member on a plain, non-pooled
 * group type is NOT released — that seat still belongs to the order.
 */
export function isSeatReleased(order: SeatOrder, seatIndex: number): boolean {
  const { ticketType } = order;
  return (
    ticketType.fixedQuantity != null &&
    ticketType.sharedStockKey != null &&
    ticketType.batch.stockSweepDone &&
    seatIndex > 0 &&
    seatHolder(order, seatIndex).name === null
  );
}
