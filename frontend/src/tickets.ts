import type { SeatHolder, SeatRole, SeatStatus } from './api/types';

/**
 * What every QR code encodes: a full link to that seat's share page, not the
 * bare token. So a guest who points their own phone camera at it lands on
 * their ticket instead of a meaningless string — and the door scanner reads
 * either form (see parseScannedToken).
 */
export function ticketUrl(token: string): string {
  return `${window.location.origin}/t/${token}`;
}

const TOKEN = /^[0-9a-f]{32}$/i;

/** Pulls the ticket token out of whatever a scanner read — a /t/<token> link or a bare token. Null for anything else. */
export function parseScannedToken(text: string): string | null {
  const raw = text.trim();
  if (TOKEN.test(raw)) return raw.toLowerCase();
  const match = raw.match(/\/t\/([0-9a-f]{32})(?:[/?#]|$)/i);
  return match ? match[1].toLowerCase() : null;
}

export const ROLE_LABEL: Record<SeatRole, string> = {
  LEADER: '主揪',
  MEMBER: '團員',
  SELF: '本人',
  COMPANION: '同行親友',
};

/** "王小明（主揪）", or a placeholder when the seat's name was never filled in. */
export function holderLabel(holder: SeatHolder): string {
  return `${holder.name ?? '（未填寫姓名）'}（${ROLE_LABEL[holder.role]}）`;
}

/**
 * The note under a seat's name: its 體系 and, for a group seat, how it relates
 * to the group — "里歐・夥伴", "里歐・王小明的親友". Empty when there is neither.
 * A group member whose marking was never filled in says so, since that is
 * what the leader still has to do.
 */
export function holderNote(
  holder: { team: string | null; relation: string | null; role: SeatRole },
  { withTeam = true, flagUnfilled = true } = {},
): string {
  const relation =
    holder.relation ?? (flagUnfilled && holder.role === 'MEMBER' ? '身分未填' : null);
  return [withTeam ? holder.team : null, relation].filter(Boolean).join('・');
}

export const SEAT_STATUS_LABEL: Record<SeatStatus, string> = {
  VALID: '可入場',
  CHECKED_IN: '已報到',
  ORDER_NOT_ACTIVE: '訂單已取消，不可入場',
  SEAT_RELEASED: '此座位已釋出，不可入場',
};

/** Taipei time regardless of the viewer's device, matching the rest of the site. */
export function formatTaipei(iso: string): string {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}
