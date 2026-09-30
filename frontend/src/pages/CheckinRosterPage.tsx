import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, CHECKIN_TOKEN_KEY } from '../api/client';
import type { CheckinSeat, RosterTeam } from '../api/types';
import { TEAM_OPTIONS } from '../constants';
import { formatTaipei, holderLabel } from '../tickets';

type Filter = 'all' | 'pending' | 'done';

const FILTER_LABEL: Record<Filter, string> = {
  all: '全部',
  pending: '未報到',
  done: '已報到',
};

/** Tab value for the counts-only overview; can't collide with a team name. */
const OVERVIEW = '';

const REFRESH_MS = 30000;

/** Teams in the same order as the registration dropdown; anything else after, 未填寫 last. */
function teamRank(team: string): number {
  if (team === '未填寫') return Number.MAX_SAFE_INTEGER;
  const i = TEAM_OPTIONS.indexOf(team);
  return i === -1 ? TEAM_OPTIONS.length : i;
}

function SeatRow({
  seat,
  busy,
  showTeam,
  onCheckIn,
  onUndo,
}: {
  seat: CheckinSeat;
  busy: boolean;
  showTeam?: boolean;
  onCheckIn: (s: CheckinSeat) => void;
  onUndo: (s: CheckinSeat) => void;
}) {
  return (
    <div className="checkin-row">
      <div>
        <div className="checkin-name">{holderLabel(seat.holder)}</div>
        <div className="hint">
          {showTeam && `${seat.team}・`}
          {seat.ticketTypeName}・第 {seat.seatIndex + 1}/{seat.seatCount} 位・{seat.buyerEmail}
        </div>
        {seat.status === 'CHECKED_IN' && seat.checkedInAt && (
          <div className="success">
            已報到 {formatTaipei(seat.checkedInAt)}（{seat.checkedInBy ?? '—'}）
          </div>
        )}
      </div>
      {seat.status === 'CHECKED_IN' ? (
        <button className="link-button" disabled={busy} onClick={() => onUndo(seat)}>
          撤銷
        </button>
      ) : (
        <button disabled={busy} onClick={() => onCheckIn(seat)}>
          {busy ? '…' : '報到'}
        </button>
      )}
    </div>
  );
}

export function CheckinRosterPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Kept in the URL so a refresh (or the 30s auto-reload) stays on the same 體系.
  const tab = params.get('team') ?? OVERVIEW;
  const [token] = useState(() => localStorage.getItem(CHECKIN_TOKEN_KEY));
  const [roster, setRoster] = useState<RosterTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!token) navigate('/checkin/login');
  }, [token, navigate]);

  const load = useCallback(() => {
    if (!token) return;
    api
      .checkinRoster(token)
      .then((data) => {
        setRoster(data);
        setError(null);
      })
      .catch(() => setError('名單載入失敗，請檢查網路'));
  }, [token]);

  useEffect(() => {
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  function selectTab(team: string) {
    setQuery('');
    setParams(team === OVERVIEW ? {} : { team }, { replace: true });
  }

  /** Swap one seat in place and recount its team, without waiting for the next refresh. */
  function applySeat(updated: CheckinSeat) {
    setRoster((teams) =>
      teams?.map((t) => {
        if (!t.seats.some((s) => s.id === updated.id)) return t;
        const seats = t.seats.map((s) => (s.id === updated.id ? updated : s));
        return { ...t, seats, checkedIn: seats.filter((s) => s.status === 'CHECKED_IN').length };
      }) ?? teams,
    );
  }

  async function checkIn(seat: CheckinSeat) {
    if (!token) return;
    setBusyId(seat.id);
    try {
      const res = await api.checkinCheckIn(token, seat.id);
      applySeat(res.ticket);
      if (res.result !== 'CHECKED_IN') {
        setError(`${holderLabel(seat.holder)}：無法報到（${res.result === 'ALREADY_CHECKED_IN' ? '已經報到過' : '此票券不可入場'}）`);
      }
    } catch {
      setError('報到失敗，請再試一次');
    } finally {
      setBusyId(null);
    }
  }

  async function undo(seat: CheckinSeat) {
    if (!token || !window.confirm(`確定要撤銷 ${holderLabel(seat.holder)} 的報到嗎？`)) return;
    setBusyId(seat.id);
    try {
      applySeat(await api.checkinUndo(token, seat.id));
    } catch {
      setError('撤銷失敗，請再試一次');
    } finally {
      setBusyId(null);
    }
  }

  const teams = useMemo(
    () =>
      roster
        ? [...roster].sort(
            (a, b) => teamRank(a.team) - teamRank(b.team) || a.team.localeCompare(b.team, 'zh-Hant'),
          )
        : [],
    [roster],
  );
  const current = teams.find((t) => t.team === tab);
  const total = teams.reduce((n, t) => n + t.total, 0);
  const checkedIn = teams.reduce((n, t) => n + t.checkedIn, 0);

  const matchesFilter = (s: CheckinSeat) =>
    filter === 'all' || (filter === 'done') === (s.status === 'CHECKED_IN');

  // Searching is across every 體系 — at the door you usually know the name,
  // not which team the buyer picked.
  const q = query.trim().toLowerCase();
  const searchResults = q
    ? teams.flatMap((t) =>
        t.seats.filter(
          (s) => (s.holder.name ?? '').toLowerCase().includes(q) || s.buyerEmail.toLowerCase().includes(q),
        ),
      )
    : null;

  const rowProps = { onCheckIn: checkIn, onUndo: undo };

  return (
    <div className="page page-wide checkin-page">
      <div className="checkin-stats">
        <span>全場已報到</span>
        <strong>{roster ? `${checkedIn} / ${total}` : '— / —'}</strong>
      </div>

      <input
        className="roster-search"
        placeholder="跨體系搜尋姓名或 email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="error">{error}</p>}
      {!roster && !error && <p className="hint">載入中…</p>}

      {searchResults ? (
        <div className="checkin-results">
          <p className="hint">搜尋「{query.trim()}」：{searchResults.length} 筆</p>
          {searchResults.map((seat) => (
            <SeatRow key={seat.id} seat={seat} busy={busyId === seat.id} showTeam {...rowProps} />
          ))}
        </div>
      ) : (
        roster && (
          <>
            <div className="roster-tabs" role="tablist" aria-label="體系">
              <button
                role="tab"
                aria-selected={tab === OVERVIEW}
                className={`roster-tab${tab === OVERVIEW ? ' is-active' : ''}`}
                onClick={() => selectTab(OVERVIEW)}
              >
                總覽
              </button>
              {teams.map((t) => (
                <button
                  key={t.team}
                  role="tab"
                  aria-selected={tab === t.team}
                  className={`roster-tab${tab === t.team ? ' is-active' : ''}`}
                  onClick={() => selectTab(t.team)}
                >
                  {t.team}
                  <span className={t.checkedIn < t.total ? 'roster-tab-count is-pending' : 'roster-tab-count'}>
                    {t.checkedIn}/{t.total}
                  </span>
                </button>
              ))}
            </div>

            {tab === OVERVIEW || !current ? (
              <div className="roster-overview" role="tabpanel">
                {tab !== OVERVIEW && !current && <p className="hint">「{tab}」目前沒有有效票券</p>}
                {teams.length === 0 && <p className="hint">目前沒有任何有效票券</p>}
                {teams.map((t) => (
                  <button key={t.team} className="roster-overview-row" onClick={() => selectTab(t.team)}>
                    <span className="roster-team-name">{t.team}</span>
                    <span className="roster-team-count">
                      已報到 {t.checkedIn} / {t.total}
                      {t.total > t.checkedIn && <span className="roster-pending">・未到 {t.total - t.checkedIn}</span>}
                    </span>
                    <span className="roster-bar" aria-hidden="true">
                      <span style={{ width: `${t.total ? (t.checkedIn / t.total) * 100 : 0}%` }} />
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div role="tabpanel" className="roster-panel">
                <div className="roster-panel-head">
                  <span className="roster-team-name">{current.team}</span>
                  <span className="roster-team-count">
                    已報到 {current.checkedIn} / {current.total}
                    {current.total > current.checkedIn && (
                      <span className="roster-pending">・未到 {current.total - current.checkedIn}</span>
                    )}
                  </span>
                </div>
                <div className="roster-filters" role="group" aria-label="篩選">
                  {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
                    <button
                      key={f}
                      className={filter === f ? '' : 'link-button'}
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                    >
                      {FILTER_LABEL[f]}
                    </button>
                  ))}
                  <button className="link-button" onClick={load}>重新整理</button>
                </div>
                <div className="checkin-results">
                  {current.seats.filter(matchesFilter).length === 0 && (
                    <p className="hint">{filter === 'pending' ? '這個體系的人都報到了' : '沒有符合的人'}</p>
                  )}
                  {current.seats.filter(matchesFilter).map((seat) => (
                    <SeatRow key={seat.id} seat={seat} busy={busyId === seat.id} {...rowProps} />
                  ))}
                </div>
              </div>
            )}
          </>
        )
      )}
    </div>
  );
}
