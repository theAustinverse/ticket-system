/**
 * The teams a registrant can belong to. MUST stay identical to TEAM_OPTIONS
 * in frontend/src/constants.ts (team-options.spec.ts fails if they drift).
 *
 * The API enforces this list: Order.registrantTeam and User.team are plain
 * strings in the database, so without a check any client could write
 * anything — which is how a hand-typed '米克' / 'Cindy -...' ended up as its
 * own team in the back office and split the per-team stats.
 *
 * Renaming or removing a team here is a DATA change too: existing orders and
 * profiles still carry the old name, and would then fail validation on their
 * next edit and show up as a separate team. Update them in the same release
 * (UPDATE "Order" SET "registrantTeam" = new WHERE "registrantTeam" = old;
 * same for "User".team). The 米克 -> 爾森 rename skipped this.
 */
export const TEAM_OPTIONS: readonly string[] = [
  '子揚',
  '維妮',
  '里歐',
  'Cindy',
  '安仔',
  '宇橋',
  '奶雞',
  '玩具城',
  '爾森',
  '鈺聖',
  '海嗨',
  '啓瑋',
  '國霆',
  '嘉誠',
  '張簡',
  '咏璇',
  '靜靜',
  '朱佳期',
  '其他',
];

export const TEAM_MESSAGE = '所屬系統/團隊必須是清單內的選項';
