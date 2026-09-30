import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

/** Teams in the same order as the registration dropdown; anything else after, 未填寫 last. */
function teamRank(team: string): number {
  if (team === '未填寫') return Number.MAX_SAFE_INTEGER;
  const i = TEAM_OPTIONS.indexOf(team);
  return i === -1 ? TEAM_OPTIONS.length : i;
}

const REFRESH_MS = 30000;

export function CheckinRosterPage() {
  const navigate = useNavigate();
  const [token] = useState(() => localStorage.getItem(CHECKIN_TOKEN_KEY));
  const [roster, setRoster] = useState<RosterTeam[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
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
      if (res.result !== 'CHECKED_IN') setError(`${holderLabel(seat.holder)}：無法報到（${res.result === 'ALREADY_CHECKED_IN' ? '已經報到過' : '此票券不可入場'}）`);
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

  const q = query.trim().toLowerCase();
  const view = useMemo(() => {
    if (!roster) return [];
    return [...roster]
      .sort((a, b) => teamRank(a.team) - teamRank(b.team) || a.team.localeCompare(b.team, 'zh-Hant'))
      .map((team) => ({
        ...team,
        shown: team.seats.filter(
          (s) =>
            (filter === 'all' || (filter === 'done') === (s.status === 'CHECKED_IN')) &&
            (!q ||
              (s.holder.name ?? '').toLowerCase().includes(q) ||
              s.buyerEmail.toLowerCase().includes(q)),
        ),
      }));
  }, [roster, filter, q]);

  const total = roster?.reduce((n, t) => n + t.total, 0) ?? 0;
  const checkedIn = roster?.reduce((n, t) => n + t.checkedIn, 0) ?? 0;

  function toggle(team: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(team)) next.delete(team);
      else next.add(team);
      return next;
    });
  }

  return (
    <div className="page page-wide checkin-page">
      <div className="checkin-stats">
        <span>全場已報到</span>
        <strong>{roster ? `${checkedIn} / ${total}` : '— / —'}</strong>
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

      <input
        className="roster-search"
        placeholder="在名單中找姓名或 email"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {error && <p className="error">{error}</p>}
      {!roster && !error && <p className="hint">載入中…</p>}
      {roster && roster.length === 0 && <p className="hint">目前沒有任何有效票券</p>}

      {view.map((team) => {
        const expanded = open.has(team.team) || !!q;
        const pending = team.total - team.checkedIn;
        return (
          <section key={team.team} className="roster-team">
            <button className="roster-team-head" aria-expanded={expanded} onClick={() => toggle(team.team)}>
              <span className="roster-team-name">{team.team}</span>
              <span className="roster-team-count">
                已報到 {team.checkedIn} / {team.total}
                {pending > 0 && <span className="roster-pending">・未到 {pending}</span>}
              </span>
              <span className="roster-bar" aria-hidden="true">
                <span style={{ width: `${team.total ? (team.checkedIn / team.total) * 100 : 0}%` }} />
              </span>
            </button>
            {expanded && (
              <div className="checkin-results">
                {team.shown.length === 0 && (
                  <p className="hint">{filter === 'pending' ? '這個體系的人都報到了' : '沒有符合的人'}</p>
                )}
                {team.shown.map((seat) => (
                  <div key={seat.id} className="checkin-row">
                    <div>
                      <div className="checkin-name">{holderLabel(seat.holder)}</div>
                      <div className="hint">
                        {seat.ticketTypeName}・第 {seat.seatIndex + 1}/{seat.seatCount} 位・{seat.buyerEmail}
                      </div>
                      {seat.status === 'CHECKED_IN' && seat.checkedInAt && (
                        <div className="success">
                          已報到 {formatTaipei(seat.checkedInAt)}（{seat.checkedInBy ?? '—'}）
                        </div>
                      )}
                    </div>
                    {seat.status === 'CHECKED_IN' ? (
                      <button className="link-button" disabled={busyId === seat.id} onClick={() => undo(seat)}>
                        撤銷
                      </button>
                    ) : (
                      <button disabled={busyId === seat.id} onClick={() => checkIn(seat)}>
                        {busyId === seat.id ? '…' : '報到'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
