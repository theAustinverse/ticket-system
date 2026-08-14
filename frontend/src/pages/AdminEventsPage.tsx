import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type { EventDetail, EventSummary, SaleBatch, TicketType } from '../api/types';

/**
 * The event is always Asia/Taipei local time regardless of admin's own
 * device timezone (same convention as EventDetailPage's countdown banner).
 * Taipei has no DST, so the offset is a fixed +8h — treating the wall-clock
 * digits as UTC and shifting by 8h is exact, no timezone library needed.
 */
function isoToTaipeiInputValue(iso: string | null): string {
  if (!iso) return '';
  const shifted = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"
}

function taipeiInputValueToIso(value: string): string | null {
  if (!value) return null;
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute] = timePart.split(':').map(Number);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute);
  return new Date(asIfUtc - 8 * 60 * 60 * 1000).toISOString();
}

function formatTaipeiDisplay(iso: string | null): string {
  if (!iso) return '未設定';
  return `${new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })} (台北時間)`;
}

/**
 * Editing totalQuantity only updates the Postgres row — the sellable count
 * in Redis is untouched until adminResetStock runs (see
 * EventService.updateTicketType's doc comment). Calling it automatically
 * after every save means there's no separate manual step to forget, which
 * matters more than usual here since this is meant to be usable from a
 * phone. resetStock derives the new Redis count from totalQuantity minus
 * real PAID orders rather than overwriting blindly, so it's always safe to
 * call — including when it touches ticket types this admin isn't editing.
 */
function TicketTypeQuantityEditor({
  ticketType,
  onSaved,
}: {
  ticketType: TicketType;
  onSaved: (updated: TicketType) => void;
}) {
  const { token } = useAdminAuth();
  const [draft, setDraft] = useState(String(ticketType.totalQuantity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(draft);
  const valid = draft.trim() !== '' && Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== ticketType.totalQuantity;

  async function handleSave() {
    if (!token || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.adminUpdateTicketType(token, ticketType.id, {
        totalQuantity: parsed,
      });
      await api.adminResetStock(token);
      onSaved({ ...ticketType, ...updated, remainingStock: parsed });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-tickettype-row">
      <span>{ticketType.name}</span>
      <input
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: '5rem' }}
      />
      <button disabled={!dirty || saving} onClick={handleSave}>
        {saving ? '儲存中…' : '儲存張數'}
      </button>
      {typeof ticketType.remainingStock === 'number' && (
        <span className="hint">剩餘：{ticketType.remainingStock}</span>
      )}
      {error && <p className="error hint">{error}</p>}
    </div>
  );
}

function BatchRow({
  batch,
  onSaved,
  onTicketTypeSaved,
}: {
  batch: SaleBatch;
  onSaved: (updated: SaleBatch) => void;
  onTicketTypeSaved: (updated: TicketType) => void;
}) {
  const { token } = useAdminAuth();
  const [startDraft, setStartDraft] = useState(isoToTaipeiInputValue(batch.saleStartAt));
  const [endDraft, setEndDraft] = useState(isoToTaipeiInputValue(batch.saleEndAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    startDraft !== isoToTaipeiInputValue(batch.saleStartAt) ||
    endDraft !== isoToTaipeiInputValue(batch.saleEndAt);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.adminUpdateBatch(token, batch.id, {
        saleStartAt: taipeiInputValueToIso(startDraft),
        saleEndAt: taipeiInputValueToIso(endDraft),
      });
      onSaved({ ...batch, ...updated });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td data-label="波次">{batch.name}</td>
      <td data-label="開賣時間">
        <input
          type="datetime-local"
          value={startDraft}
          onChange={(e) => setStartDraft(e.target.value)}
        />
        <p className="hint">目前：{formatTaipeiDisplay(batch.saleStartAt)}</p>
      </td>
      <td data-label="截止時間">
        <input
          type="datetime-local"
          value={endDraft}
          onChange={(e) => setEndDraft(e.target.value)}
        />
        <p className="hint">目前：{formatTaipeiDisplay(batch.saleEndAt)}</p>
      </td>
      <td data-label="票種">
        <div className="admin-tickettype-list">
          {batch.ticketTypes.map((tt) => (
            <TicketTypeQuantityEditor key={tt.id} ticketType={tt} onSaved={onTicketTypeSaved} />
          ))}
        </div>
      </td>
      <td data-label="操作">
        <button disabled={!dirty || saving} onClick={handleSave}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        {error && <p className="error hint">{error}</p>}
      </td>
    </tr>
  );
}

export function AdminEventsPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    api
      .listEvents()
      .then((summaries: EventSummary[]) => Promise.all(summaries.map((s) => api.getEvent(s.id))))
      .then(setEvents)
      .catch((err) => setError(err instanceof ApiError ? err.message : '載入失敗'));
  }, [token, navigate]);

  function updateBatchInState(sessionId: string, updated: SaleBatch) {
    setEvents(
      (prev) =>
        prev?.map((event) => ({
          ...event,
          sessions: event.sessions.map((session) =>
            session.id !== sessionId
              ? session
              : {
                  ...session,
                  batches: session.batches.map((b) => (b.id === updated.id ? updated : b)),
                },
          ),
        })) ?? null,
    );
  }

  function updateTicketTypeInState(updated: TicketType) {
    setEvents(
      (prev) =>
        prev?.map((event) => ({
          ...event,
          sessions: event.sessions.map((session) => ({
            ...session,
            batches: session.batches.map((batch) => ({
              ...batch,
              ticketTypes: batch.ticketTypes.map((tt) =>
                tt.id === updated.id ? { ...tt, ...updated } : tt,
              ),
            })),
          })),
        })) ?? null,
    );
  }

  if (error) return <div className="page error">{error}</div>;
  if (!events) return <div className="page">載入中…</div>;

  return (
    <div className="page">
      <Link to="/admin/dashboard" className="link-button">
        ← 返回後台選單
      </Link>
      <h1>波次開賣時間管理</h1>
      <p className="hint">
        設定每一波的開賣／截止時間（台北時間）。開賣時間一旦設定，前台會自動顯示倒數計時，不需要另外調整程式。
      </p>
      {events.map((event) => (
        <div key={event.id}>
          {event.sessions.map((session) => (
            <div key={session.id} className="admin-table-wrap">
              <h2>
                {event.name} — {session.venue}
              </h2>
              <table className="admin-table admin-table-cards">
                <thead>
                  <tr>
                    <th>波次</th>
                    <th>開賣時間</th>
                    <th>截止時間</th>
                    <th>票種</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {session.batches.map((batch) => (
                    <BatchRow
                      key={batch.id}
                      batch={batch}
                      onSaved={(updated) => updateBatchInState(session.id, updated)}
                      onTicketTypeSaved={updateTicketTypeInState}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
