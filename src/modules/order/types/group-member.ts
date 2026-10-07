/**
 * Whether a group member is a colleague ("夥伴") or someone's relative or
 * friend ("親友"). The group bundle is for 夥伴; a 親友 rides on one of them.
 */
export type GroupMemberKind = 'PARTNER' | 'RELATIVE';

/** One of the fixedQuantity-1 additional group members (the leader is the 11th seat, already covered by registrant/groupLeader fields). */
export interface GroupMember {
  name: string;
  contact: string;
  mealPreference: string;
  /**
   * Absent on orders placed before this was asked; a named member must carry
   * one from now on (see validateGroupMemberKinds).
   */
  kind?: GroupMemberKind;
  /**
   * Only with kind RELATIVE: the seat of the partner this person is the
   * relative of — 0 is the leader, 1..n the members in list order. A seat
   * index rather than a name, so correcting a spelling doesn't orphan it.
   */
  relativeOfSeat?: number;
}
