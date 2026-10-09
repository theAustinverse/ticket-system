/**
 * What's new on the site, newest first. The home page shows the entries from
 * the last RECENT_DAYS days (section at the bottom + a one-time popup), so
 * adding a user-facing feature means adding an entry here in the same release.
 * Back-office-only changes don't belong: this is written for visitors.
 */
export interface ChangelogEntry {
  /** Stable id: the popup remembers the newest one a visitor has seen. */
  id: string;
  /** Taipei calendar date, YYYY-MM-DD. */
  date: string;
  title: string;
  body: string;
}

export const RECENT_DAYS = 3;

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-10-09-tour-update',
    date: '2026-10-09',
    title: '使用教學更新',
    body: '上方的「📖 使用教學」更新成最新版：新增團體票「夥伴／夥伴的親友」填法、一人一張本人票的規則、轉讓與退票的限制，也介紹了小額贊助、聯絡我們和客服小幫手。',
  },
  {
    id: '2026-10-09-help-bot',
    date: '2026-10-09',
    title: '客服小幫手上線',
    body: '登入後點右下角的 ❓，就能詢問系統操作的問題（怎麼退票、怎麼轉讓、小額贊助怎麼用…）。小幫手答不出來的，會轉給管理員，回覆後直接顯示在同一個視窗。',
  },
  {
    id: '2026-10-09-official-line',
    date: '2026-10-09',
    title: '新增「官方 LINE」按鈕',
    body: '首頁的聯絡區塊和「聯絡我們」頁面，現在可以一鍵加入官方 LINE。',
  },
  {
    id: '2026-10-09-home-story',
    date: '2026-10-09',
    title: '首頁全新捲動體驗',
    body: '首頁改版成全螢幕主視覺，往下捲動時內容會依序浮現，右側也多了章節導覽點。',
  },
  {
    id: '2026-10-07-contact',
    date: '2026-10-07',
    title: '新增「聯絡我們」頁面',
    body: '上方選單新增「聯絡我們」，列出公開的聯絡窗口（姓名、LINE ID、Email），首頁下方也看得到。',
  },
  {
    id: '2026-10-07-anti-scam',
    date: '2026-10-07',
    title: '防詐騙提醒跑馬燈',
    body: '票券收費統一繳交給領導人，任何人以其他形式收費都是詐騙。這則提醒會固定顯示在頁面最上方。',
  },
];

/** Today's date in Taipei as YYYY-MM-DD, whatever the visitor's device clock/timezone says. */
function taipeiToday(now: Date): string {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' });
}

/** Entries from the last `days` calendar days (today counts as day 1), in the order given. */
export function recentEntries(
  entries: ChangelogEntry[],
  now: Date = new Date(),
  days: number = RECENT_DAYS,
): ChangelogEntry[] {
  const [y, m, d] = taipeiToday(now).split('-').map(Number);
  const cutoff = new Date(Date.UTC(y, m - 1, d - (days - 1))).toISOString().slice(0, 10);
  return entries.filter((e) => e.date >= cutoff);
}
