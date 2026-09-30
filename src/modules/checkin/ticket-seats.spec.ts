import {
  isSeatReleased,
  newTicketToken,
  seatHolder,
  type SeatOrder,
} from './ticket-seats';

function order(overrides: Partial<SeatOrder> = {}): SeatOrder {
  return {
    registrantName: '王小明',
    mealPreference: '葷食',
    groupLeaderName: null,
    groupMembers: null,
    companions: null,
    buyingForFamily: false,
    ticketType: { fixedQuantity: null, sharedStockKey: null, batch: { stockSweepDone: false } },
    ...overrides,
  };
}

const groupType = (overrides = {}) => ({
  fixedQuantity: 11,
  sharedStockKey: null as string | null,
  batch: { stockSweepDone: false },
  ...overrides,
});

describe('seatHolder', () => {
  it('individual ticket: seat 0 is the buyer, later seats are companions in order', () => {
    const o = order({
      companions: [
        { name: '王媽媽', relationship: '父母', mealPreference: '素食', note: 'n' },
        { name: '王妹妹', relationship: '兄弟姊妹', mealPreference: '葷食', note: 'n' },
      ],
    });
    expect(seatHolder(o, 0)).toEqual({ name: '王小明', role: 'SELF', mealPreference: '葷食' });
    expect(seatHolder(o, 1)).toEqual({ name: '王媽媽', role: 'COMPANION', mealPreference: '素食' });
    expect(seatHolder(o, 2).name).toBe('王妹妹');
  });

  it('buyingForFamily: the buyer holds no seat — seat 0 is the first companion, not the buyer', () => {
    const o = order({
      buyingForFamily: true,
      companions: [
        { name: '王爸爸', relationship: '父母', mealPreference: '葷食', note: 'n' },
        { name: '王媽媽', relationship: '父母', mealPreference: '素食', note: 'n' },
      ],
    });
    expect(seatHolder(o, 0)).toEqual({ name: '王爸爸', role: 'COMPANION', mealPreference: '葷食' });
    expect(seatHolder(o, 1).name).toBe('王媽媽');
  });

  it('group bundle: seat 0 is the leader, seats 1..10 are the members', () => {
    const o = order({
      groupLeaderName: '主揪陳',
      ticketType: groupType(),
      groupMembers: [
        { name: '團員一', contact: 'c', mealPreference: '素食' },
        { name: '', contact: '', mealPreference: '' },
      ],
    });
    expect(seatHolder(o, 0)).toEqual({ name: '主揪陳', role: 'LEADER', mealPreference: '葷食' });
    expect(seatHolder(o, 1)).toEqual({ name: '團員一', role: 'MEMBER', mealPreference: '素食' });
    expect(seatHolder(o, 2)).toEqual({ name: null, role: 'MEMBER', mealPreference: null });
  });

  it('tolerates the legacy plain-string member shape', () => {
    const o = order({ ticketType: groupType(), groupMembers: ['老格式', '  '] });
    expect(seatHolder(o, 1).name).toBe('老格式');
    expect(seatHolder(o, 2).name).toBeNull();
  });

  it('a seat beyond the recorded list reads as unnamed rather than throwing', () => {
    expect(seatHolder(order({ companions: [] }), 3).name).toBeNull();
  });
});

describe('isSeatReleased — must match what StockSweepService actually released', () => {
  const blankMembers = [{ name: '', contact: '', mealPreference: '' }];

  it('a blank member seat on a swept shared-pool group type is released', () => {
    const o = order({
      ticketType: groupType({ sharedStockKey: 'pool', batch: { stockSweepDone: true } }),
      groupMembers: blankMembers,
    });
    expect(isSeatReleased(o, 1)).toBe(true);
  });

  it.each([
    ['the wave has not been swept yet', groupType({ sharedStockKey: 'pool' })],
    ['the group type is not pooled (sweep never releases its blank members)', groupType({ batch: { stockSweepDone: true } })],
  ])('is NOT released when %s', (_label, ticketType) => {
    expect(isSeatReleased(order({ ticketType, groupMembers: blankMembers }), 1)).toBe(false);
  });

  it("never releases the leader's seat or a named member", () => {
    const o = order({
      ticketType: groupType({ sharedStockKey: 'pool', batch: { stockSweepDone: true } }),
      groupLeaderName: '',
      registrantName: '',
      groupMembers: [{ name: '有名字', contact: '', mealPreference: '' }],
    });
    expect(isSeatReleased(o, 0)).toBe(false);
    expect(isSeatReleased(o, 1)).toBe(false);
  });

  it('never applies to individual tickets', () => {
    expect(isSeatReleased(order({ companions: [] }), 1)).toBe(false);
  });
});

describe('newTicketToken', () => {
  it('is 32 hex chars and does not repeat', () => {
    const tokens = Array.from({ length: 500 }, newTicketToken);
    expect(tokens.every((t) => /^[0-9a-f]{32}$/.test(t))).toBe(true);
    expect(new Set(tokens).size).toBe(500);
  });
});
