import { BadRequestException } from '@nestjs/common';
import type { GroupMember } from './types/group-member';

/**
 * Checks and tidies the partner/relative marking on a group's member list.
 *
 * Seats are numbered as on the ticket: 0 is the leader, member i of the list
 * is seat i + 1. Rules, for every member with a name (a blank seat is still
 * allowed — the list may be filled in later — and carries no marking):
 * - it must say whether it is a 夥伴 (PARTNER) or a 親友 (RELATIVE);
 * - a 親友 must name the partner it belongs to, and that seat must be the
 *   leader or a named PARTNER, never another 親友 and never itself, so the
 *   ticket can always say "<partner>的親友".
 *
 * Returns the members with stray fields dropped (a PARTNER has no
 * relativeOfSeat, a blank seat has neither), so a stale relative-of can't
 * outlive the change that made it meaningless.
 */
export function validateGroupMemberKinds(
  members: GroupMember[],
  seatCount: number,
): GroupMember[] {
  const named = (m: GroupMember) => m.name.trim().length > 0;

  return members.map((member, i) => {
    const seat = i + 1;
    if (!named(member)) {
      const { kind: _kind, relativeOfSeat: _of, ...blank } = member;
      return blank;
    }
    if (member.kind !== 'PARTNER' && member.kind !== 'RELATIVE') {
      throw new BadRequestException(
        `請選擇「${member.name.trim()}」是夥伴還是親友`,
      );
    }
    if (member.kind === 'PARTNER') {
      const { relativeOfSeat: _of, ...partner } = member;
      return partner;
    }

    const target = member.relativeOfSeat;
    if (
      target === undefined ||
      !Number.isInteger(target) ||
      target < 0 ||
      target >= seatCount ||
      target === seat
    ) {
      throw new BadRequestException(
        `請選擇「${member.name.trim()}」是哪一位夥伴的親友`,
      );
    }
    const owner = target === 0 ? undefined : members[target - 1];
    if (target !== 0 && (!owner || !named(owner) || owner.kind !== 'PARTNER')) {
      throw new BadRequestException(
        `「${member.name.trim()}」所屬的必須是已填寫、且身分為夥伴的人`,
      );
    }
    return member;
  });
}
