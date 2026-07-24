import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { EventDetail, SaleBatch, TicketType } from '../api/types';

function isProfileComplete(profile: {
  name: string | null;
  team: string | null;
  lineId: string | null;
  phone: string | null;
}): boolean {
  return !!(profile.name && profile.team && profile.lineId && profile.phone);
}

/**
 * All sale times are for a Taipei event, so they're shown in Asia/Taipei
 * time for every viewer regardless of the viewer's own device timezone.
 */
function formatTaipeiDateTime(iso: string): string {
  return `${new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })} (台北時間)`;
}

function batchStatus(batch: SaleBatch): { label: string; open: boolean; closed: boolean } {
  if (!batch.saleStartAt) return { label: '開賣時間未定', open: false, closed: false };
  const startsAt = new Date(batch.saleStartAt).getTime();
  if (startsAt > Date.now()) {
    return {
      label: `開賣時間：${formatTaipeiDateTime(batch.saleStartAt)}`,
      open: false,
      closed: false,
    };
  }
  if (batch.saleEndAt && new Date(batch.saleEndAt).getTime() <= Date.now()) {
    return { label: '已截止', open: false, closed: true };
  }
  return { label: '搶購中', open: true, closed: false };
}

/** The soonest still-locked batch across every session — the one worth counting down to. */
function earliestUpcomingBatch(sessions: EventDetail['sessions']): SaleBatch | null {
  const now = Date.now();
  let candidate: SaleBatch | null = null;
  for (const session of sessions) {
    for (const batch of session.batches) {
      if (!batch.saleStartAt) continue;
      const startsAt = new Date(batch.saleStartAt).getTime();
      if (startsAt <= now) continue;
      if (!candidate || startsAt < new Date(candidate.saleStartAt!).getTime()) {
        candidate = batch;
      }
    }
  }
  return candidate;
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)} : ${pad(minutes)} : ${pad(seconds)}`;
}

function CountdownBanner({ batch }: { batch: SaleBatch }) {
  const targetMs = new Date(batch.saleStartAt!).getTime();
  const [remainingMs, setRemainingMs] = useState(() => targetMs - Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setRemainingMs(targetMs - Date.now());
    }, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  if (remainingMs <= 0) return null;

  return (
    <div className="countdown-block">
      <p className="countdown-label">{batch.name}開賣倒數</p>
      <p className="countdown-clock">{formatCountdown(remainingMs)}</p>
      <p className="countdown-units">時　　分　　秒</p>
    </div>
  );
}

/**
 * A ticket type sharing a stock pool never shows its own per-row count —
 * the banner above the row already states the pool's true total/remaining,
 * and a second number invites being misread as separate capacity. Only a
 * ticket type with independent (non-pooled) stock shows its own count.
 */
function remainingStockHint(ticketType: TicketType): string | null {
  if (typeof ticketType.remainingStock !== 'number') return null;
  if (ticketType.sharedStockKey) return null;
  return `剩餘 ${ticketType.remainingStock} 張`;
}

/** One summary line per distinct shared pool within a batch — the pool's true total/remaining, since per-row numbers alone can't be summed. */
function sharedPoolSummaries(ticketTypes: TicketType[]) {
  const groups = new Map<string, TicketType[]>();
  for (const tt of ticketTypes) {
    if (!tt.sharedStockKey) continue;
    const list = groups.get(tt.sharedStockKey) ?? [];
    list.push(tt);
    groups.set(tt.sharedStockKey, list);
  }
  return Array.from(groups.entries())
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => {
      // A group-capped ticket type's remainingStock is tightened by its own
      // bundle cap; whichever sibling has no such cap reports the pool's
      // true remaining seats, so take the max across the group.
      const remaining = list.reduce<number | null>((max, tt) => {
        if (typeof tt.remainingStock !== 'number') return max;
        return max === null ? tt.remainingStock : Math.max(max, tt.remainingStock);
      }, null);
      return {
        key,
        names: list.map((tt) => tt.name),
        remaining,
        total: list[0].poolTotalQuantity,
      };
    });
}

function TicketTypeRow({
  ticketType,
  open,
  closed,
}: {
  ticketType: TicketType;
  open: boolean;
  closed: boolean;
}) {
  const navigate = useNavigate();
  const { token } = useAuth();
  const required = ticketType.fixedQuantity ?? 1;
  const soldOut =
    typeof ticketType.remainingStock === 'number' &&
    ticketType.remainingStock < required;
  const canBuy = open && !soldOut;

  let buttonLabel = '尚未開賣';
  if (closed) buttonLabel = '已截止';
  else if (open) buttonLabel = soldOut ? '已售完' : '搶票';

  return (
    <div className="ticket-type-row">
      <div className="ticket-type-info">
        <strong>{ticketType.name}</strong>
        <span className="price">NT$ {ticketType.price.toLocaleString()}</span>
        {ticketType.fixedQuantity && (
          <span className="badge">每次限購 {ticketType.fixedQuantity} 張</span>
        )}
      </div>
      <span className="ticket-type-hint">
        {token ? remainingStockHint(ticketType) : null}
      </span>
      <div className="ticket-type-action">
        <button
          disabled={!canBuy}
          onClick={() => {
            if (ticketType.requiresPasscode) {
              const passcode = window.prompt('請輸入通行碼');
              if (passcode === null) return;
              navigate(`/register/${ticketType.id}`, { state: { passcode } });
              return;
            }
            navigate(`/register/${ticketType.id}`);
          }}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  );
}

export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const { token } = useAuth();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileIncomplete, setProfileIncomplete] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    api
      .getEvent(eventId)
      .then((data) => {
        setEvent(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '載入活動資料失敗，請重新整理再試一次');
        setLoading(false);
      });
  }, [eventId]);

  useEffect(() => {
    if (!token) return;
    api
      .getProfile(token)
      .then((profile) => setProfileIncomplete(!isProfileComplete(profile)))
      .catch(() => {});
  }, [token]);

  if (loading) return <div className="page">載入中…</div>;
  if (error) return <div className="page error">{error}</div>;
  if (!event) return <div className="page">找不到活動</div>;

  const countdownBatch = earliestUpcomingBatch(event.sessions);

  return (
    <div className="page">
      <h1>{event.name}</h1>
      {event.description && <p className="event-theme">{event.description}</p>}
      {profileIncomplete && (
        <p className="error">
          請先至<Link to="/profile">「設定」</Link>頁面完成個人資料填寫，才能進行搶票
        </p>
      )}
      {countdownBatch && <CountdownBanner batch={countdownBatch} />}

      {event.sessions.map((session) => (
        <div key={session.id} className="session-block">
          {token ? (
            <>
              <h2>
                {session.venue} · {formatTaipeiDateTime(session.startTime)}
              </h2>
              {session.mapUrl && (
                <a
                  className="venue-map-link"
                  href={session.mapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  在 Google 地圖開啟場地位置 ↗
                </a>
              )}
            </>
          ) : (
            <h2>登入後才可查看用餐地點</h2>
          )}
          {session.batches.map((batch) => {
            const status = batchStatus(batch);
            return (
              <div key={batch.id} className="batch-block">
                <h3>
                  {batch.name} <span className="batch-status">{status.label}</span>
                </h3>
                {token &&
                  sharedPoolSummaries(batch.ticketTypes).map((pool) => (
                    <p key={pool.key} className="hint pool-summary">
                      {pool.names.join('、')} 共用票池：剩餘 {pool.remaining ?? '—'} /{' '}
                      {pool.total ?? '—'} 張
                    </p>
                  ))}
                {batch.ticketTypes.map((tt) => (
                  <TicketTypeRow
                    key={tt.id}
                    ticketType={tt}
                    open={status.open}
                    closed={status.closed}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
