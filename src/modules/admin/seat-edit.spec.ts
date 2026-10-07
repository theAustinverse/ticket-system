import { BadRequestException } from '@nestjs/common';
import { applySeatEdit, type SeatEditOrder } from './seat-edit';

const base = {
  quantity: 3,
  registrantName: '買家',
  mealPreference: '葷食',
  groupLeaderName: null,
  groupMembers: null,
  companions: null,
  buyingForFamily: false,
  ticketType: { fixedQuantity: null },
} satisfies SeatEditOrder;

const group: SeatEditOrder = {
  ...base,
  quantity: 3,
  groupLeaderName: '主揪',
  groupMembers: [
    { name: '羽萱', contact: '0911', mealPreference: '葷食', kind: 'PARTNER' },
    '舊字串成員',
  ],
  ticketType: { fixedQuantity: 2 },
};

describe('applySeatEdit', () => {
  it('group seat 0 edits the leader name and the order meal', () => {
    const r = applySeatEdit(group, 0, { name: '新主揪', mealPreference: '素食' });
    expect(r.data).toEqual({ groupLeaderName: '新主揪', mealPreference: '素食' });
    expect(r.before).toEqual({ seatIndex: 0, name: '主揪', mealPreference: '葷食' });
    expect(r.after).toEqual({ seatIndex: 0, name: '新主揪', mealPreference: '素食' });
  });

  it('group seat i edits groupMembers[i-1] and keeps its kind and contact', () => {
    const r = applySeatEdit(group, 1, { name: '洪羽萱' });
    const members = r.data.groupMembers as any[];
    expect(members[0]).toEqual({
      name: '洪羽萱',
      contact: '0911',
      mealPreference: '葷食',
      kind: 'PARTNER',
    });
    expect(members[1]).toBe('舊字串成員');
    expect(r.before.name).toBe('羽萱');
  });

  it('upgrades a legacy plain-string member to the object shape on edit', () => {
    const r = applySeatEdit(group, 2, { name: '新名字' });
    expect((r.data.groupMembers as any[])[1]).toEqual({
      name: '新名字',
      contact: '',
      mealPreference: '',
    });
    expect(r.before.name).toBe('舊字串成員');
  });

  it('fills a seat that has no member entry yet', () => {
    const r = applySeatEdit({ ...group, groupMembers: [] }, 2, { name: '補上' });
    expect((r.data.groupMembers as any[])[1].name).toBe('補上');
  });

  it('individual seat 0 edits the buyer; seat i edits companions[i-1]', () => {
    const order: SeatEditOrder = {
      ...base,
      companions: [{ name: '伴侶', relationship: '伴侶', mealPreference: '葷食', note: 'n' }],
    };
    expect(applySeatEdit(order, 0, { name: '改名' }).data).toEqual({
      registrantName: '改名',
    });
    const r = applySeatEdit(order, 1, { name: '新伴侶' });
    expect((r.data.companions as any[])[0]).toEqual({
      name: '新伴侶',
      relationship: '伴侶',
      mealPreference: '葷食',
      note: 'n',
    });
  });

  it('buying for family: the buyer holds no seat, so seat i is companions[i]', () => {
    const order: SeatEditOrder = {
      ...base,
      quantity: 2,
      buyingForFamily: true,
      companions: [
        { name: '甲', relationship: '', mealPreference: '', note: '' },
        { name: '乙', relationship: '', mealPreference: '', note: '' },
      ],
    };
    const r = applySeatEdit(order, 0, { name: '甲改' });
    expect((r.data.companions as any[])[0].name).toBe('甲改');
    expect(r.data.registrantName).toBeUndefined();
  });

  it('refuses a blank name, an empty edit, and a seat that does not exist', () => {
    expect(() => applySeatEdit(group, 1, { name: '  ' })).toThrow(BadRequestException);
    expect(() => applySeatEdit(group, 1, {})).toThrow(BadRequestException);
    expect(() => applySeatEdit(group, 3, { name: 'x' })).toThrow(BadRequestException);
    expect(() => applySeatEdit(group, -1, { name: 'x' })).toThrow(BadRequestException);
  });

  it('does not mutate the order it was given', () => {
    const snapshot = JSON.stringify(group);
    applySeatEdit(group, 1, { name: '改' });
    expect(JSON.stringify(group)).toBe(snapshot);
  });
});
