import { BadRequestException } from '@nestjs/common';
import { validateGroupMemberKinds } from './group-member-kinds';
import type { GroupMember } from './types/group-member';

const member = (name: string, extra: Partial<GroupMember> = {}): GroupMember => ({
  name,
  contact: '',
  mealPreference: '葷食',
  ...extra,
});

// A 4-seat bundle: seat 0 is the leader, members are seats 1..3.
const SEATS = 4;

describe('validateGroupMemberKinds', () => {
  it('accepts named partners and a relative of the leader (seat 0)', () => {
    const out = validateGroupMemberKinds(
      [
        member('甲', { kind: 'PARTNER' }),
        member('乙', { kind: 'RELATIVE', relativeOfSeat: 0 }),
        member('丙', { kind: 'PARTNER' }),
      ],
      SEATS,
    );

    expect(out[1]).toMatchObject({ kind: 'RELATIVE', relativeOfSeat: 0 });
  });

  it('accepts a relative of another named partner', () => {
    const out = validateGroupMemberKinds(
      [
        member('甲', { kind: 'PARTNER' }),
        member('乙', { kind: 'RELATIVE', relativeOfSeat: 1 }),
        member(''),
      ],
      SEATS,
    );

    expect(out[1]!.relativeOfSeat).toBe(1);
  });

  it('refuses a named member with no marking, naming the person', () => {
    expect(() =>
      validateGroupMemberKinds([member('甲'), member(''), member('')], SEATS),
    ).toThrow('請選擇「甲」是夥伴還是親友');
  });

  it('lets a blank seat stay unmarked, and drops any marking left on it', () => {
    const out = validateGroupMemberKinds(
      [member('', { kind: 'RELATIVE', relativeOfSeat: 0 }), member(''), member('')],
      SEATS,
    );

    expect(out[0]).not.toHaveProperty('kind');
    expect(out[0]).not.toHaveProperty('relativeOfSeat');
  });

  it('drops a stale relativeOfSeat from a partner', () => {
    const out = validateGroupMemberKinds(
      [member('甲', { kind: 'PARTNER', relativeOfSeat: 2 }), member(''), member('')],
      SEATS,
    );

    expect(out[0]).not.toHaveProperty('relativeOfSeat');
  });

  it.each([
    ['no partner chosen', undefined],
    ['their own seat', 1],
    ['a seat past the end', 9],
    ['a negative seat', -1],
    ['a fractional seat', 0.5],
  ])('refuses a relative with %s', (_label, target) => {
    expect(() =>
      validateGroupMemberKinds(
        [member('甲', { kind: 'RELATIVE', relativeOfSeat: target }), member(''), member('')],
        SEATS,
      ),
    ).toThrow(BadRequestException);
  });

  it('refuses a relative of another relative, so a ticket can always say whose', () => {
    expect(() =>
      validateGroupMemberKinds(
        [
          member('甲', { kind: 'RELATIVE', relativeOfSeat: 0 }),
          member('乙', { kind: 'RELATIVE', relativeOfSeat: 1 }),
          member(''),
        ],
        SEATS,
      ),
    ).toThrow('必須是已填寫、且身分為夥伴的人');
  });

  it('refuses a relative of a seat that is still blank', () => {
    expect(() =>
      validateGroupMemberKinds(
        [member(''), member('乙', { kind: 'RELATIVE', relativeOfSeat: 1 }), member('')],
        SEATS,
      ),
    ).toThrow('必須是已填寫、且身分為夥伴的人');
  });
});
