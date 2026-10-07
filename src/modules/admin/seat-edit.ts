import { BadRequestException } from '@nestjs/common';
import type { GroupMember } from '../order/types/group-member';
import type { Companion } from '../order/types/companion';

export interface SeatEdit {
  name?: string;
  mealPreference?: string;
}

/** The order fields a seat edit reads (a structural subset of Prisma's Order + ticket type). */
export interface SeatEditOrder {
  quantity: number;
  registrantName: string;
  mealPreference: string;
  groupLeaderName: string | null;
  groupMembers: unknown;
  companions: unknown;
  buyingForFamily: boolean;
  ticketType: { fixedQuantity: number | null };
}

export interface SeatEditResult {
  /** Fields to write on the Order — only the ones that changed. */
  data: Record<string, unknown>;
  before: { seatIndex: number; name: string | null; mealPreference: string | null };
  after: { seatIndex: number; name: string | null; mealPreference: string | null };
}

/**
 * Works out where seat `seatIndex` lives on the order and what to write to
 * change it. Mirrors the seat mapping in `seatHolder()` (ticket-seats.ts) —
 * change one, change the other:
 *
 * - group bundle: seat 0 is the leader (groupLeaderName / mealPreference),
 *   seat i is groupMembers[i - 1];
 * - individual, own ticket: seat 0 is the buyer (registrantName /
 *   mealPreference), seat i is companions[i - 1];
 * - individual bought for family: the buyer holds no seat, seat i is
 *   companions[i].
 *
 * Pure — no I/O — so the mapping can be tested without a database. It only
 * changes name and meal; contacts, partner/relative marks and the QR token
 * are left alone, so the seat's QR code keeps working.
 */
export function applySeatEdit(
  order: SeatEditOrder,
  seatIndex: number,
  edit: SeatEdit,
): SeatEditResult {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= order.quantity) {
    throw new BadRequestException(`這張訂單沒有第 ${seatIndex + 1} 個座位`);
  }
  const name = edit.name?.trim();
  const meal = edit.mealPreference?.trim();
  if (edit.name !== undefined && !name) {
    throw new BadRequestException('姓名不能留白');
  }
  if (name === undefined && meal === undefined) {
    throw new BadRequestException('沒有要修改的欄位');
  }

  const data: Record<string, unknown> = {};
  let beforeName: string | null;
  let beforeMeal: string | null;

  if (order.ticketType.fixedQuantity != null) {
    if (seatIndex === 0) {
      beforeName = order.groupLeaderName?.trim() || order.registrantName || null;
      beforeMeal = order.mealPreference || null;
      if (name !== undefined) data.groupLeaderName = name;
      if (meal !== undefined) data.mealPreference = meal;
    } else {
      const members = Array.isArray(order.groupMembers)
        ? [...(order.groupMembers as (GroupMember | string)[])]
        : [];
      const current = members[seatIndex - 1];
      const base: GroupMember =
        typeof current === 'string'
          ? { name: current, contact: '', mealPreference: '' }
          : (current ?? { name: '', contact: '', mealPreference: '' });
      beforeName = base.name || null;
      beforeMeal = base.mealPreference || null;
      members[seatIndex - 1] = {
        ...base,
        ...(name !== undefined ? { name } : {}),
        ...(meal !== undefined ? { mealPreference: meal } : {}),
      };
      data.groupMembers = members;
    }
  } else if (!order.buyingForFamily && seatIndex === 0) {
    beforeName = order.registrantName || null;
    beforeMeal = order.mealPreference || null;
    if (name !== undefined) data.registrantName = name;
    if (meal !== undefined) data.mealPreference = meal;
  } else {
    const index = order.buyingForFamily ? seatIndex : seatIndex - 1;
    const companions = Array.isArray(order.companions)
      ? [...(order.companions as Companion[])]
      : [];
    const base: Companion = companions[index] ?? {
      name: '',
      relationship: '',
      mealPreference: '',
      note: '',
    };
    beforeName = base.name || null;
    beforeMeal = base.mealPreference || null;
    companions[index] = {
      ...base,
      ...(name !== undefined ? { name } : {}),
      ...(meal !== undefined ? { mealPreference: meal } : {}),
    };
    data.companions = companions;
  }

  return {
    data,
    before: { seatIndex, name: beforeName, mealPreference: beforeMeal },
    after: {
      seatIndex,
      name: name ?? beforeName,
      mealPreference: meal ?? beforeMeal,
    },
  };
}
