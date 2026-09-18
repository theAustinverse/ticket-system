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
/**
 * sharedStockKey / poolTotalQuantity / maxGroupOrders / groupBundleTotalAmount
 * / requiresPasscode all live here rather than on the quantity row above,
 * since editing them is rare and higher-stakes (e.g. migrating an
 * already-selling independent ticket type onto a shared pool with a
 * sibling) — collapsed by default so it doesn't clutter the common case.
 */
function TicketTypeAdvancedEditor({
  ticketType,
  onSaved,
}: {
  ticketType: TicketType;
  onSaved: (updated: TicketType) => void;
}) {
  const { token } = useAdminAuth();
  const [open, setOpen] = useState(false);
  const [sharedStockKey, setSharedStockKey] = useState(ticketType.sharedStockKey ?? '');
  const [poolTotalQuantity, setPoolTotalQuantity] = useState(
    ticketType.poolTotalQuantity != null ? String(ticketType.poolTotalQuantity) : '',
  );
  const [maxGroupOrders, setMaxGroupOrders] = useState(
    ticketType.maxGroupOrders != null ? String(ticketType.maxGroupOrders) : '',
  );
  const [groupBundleTotalAmount, setGroupBundleTotalAmount] = useState(
    ticketType.groupBundleTotalAmount != null
      ? String(ticketType.groupBundleTotalAmount)
      : '',
  );
  const [requiresPasscode, setRequiresPasscode] = useState(ticketType.requiresPasscode);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const dto: Parameters<typeof api.adminUpdateTicketType>[2] = {
        requiresPasscode,
      };
      if (sharedStockKey.trim()) dto.sharedStockKey = sharedStockKey.trim();
      if (poolTotalQuantity.trim()) dto.poolTotalQuantity = Number(poolTotalQuantity);
      if (maxGroupOrders.trim()) dto.maxGroupOrders = Number(maxGroupOrders);
      if (groupBundleTotalAmount.trim())
        dto.groupBundleTotalAmount = Number(groupBundleTotalAmount);

      const updated = await api.adminUpdateTicketType(token, ticketType.id, dto);
      await api.adminResetStock(token);
      onSaved({ ...ticketType, ...updated });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        進階設定 ▾
      </button>
    );
  }

  return (
    <div className="admin-tickettype-advanced">
      <label>
        共用票池 key（留空＝獨立庫存）
        <input
          value={sharedStockKey}
          onChange={(e) => setSharedStockKey(e.target.value)}
          placeholder="例如 wave2-pool"
        />
      </label>
      <label>
        票池總量（與共用此 key 的其他票種必須一致）
        <input
          type="number"
          min={0}
          value={poolTotalQuantity}
          onChange={(e) => setPoolTotalQuantity(e.target.value)}
        />
      </label>
      <label>
        團體訂單組數上限（留空＝不限組數）
        <input
          type="number"
          min={0}
          value={maxGroupOrders}
          onChange={(e) => setMaxGroupOrders(e.target.value)}
        />
      </label>
      <label>
        套票固定總價（留空＝用單價×張數計算）
        <input
          type="number"
          min={0}
          value={groupBundleTotalAmount}
          onChange={(e) => setGroupBundleTotalAmount(e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={requiresPasscode}
          onChange={(e) => setRequiresPasscode(e.target.checked)}
        />
        需要通關密碼才能排隊
      </label>
      <div className="button-row">
        <button disabled={saving} onClick={handleSave}>
          {saving ? '儲存中…' : '儲存進階設定'}
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          收合
        </button>
      </div>
      {error && <p className="error hint">{error}</p>}
    </div>
  );
}

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
      <TicketTypeAdvancedEditor ticketType={ticketType} onSaved={onSaved} />
    </div>
  );
}

/**
 * Appends a brand-new ticket type to an existing batch — e.g. adding a group
 * bundle that shares a pool with a batch's existing individual ticket type.
 * Joining an existing pool is safe regardless of ordering: createTicketType
 * only SETNX-initializes the pool if nothing has, and the adminResetStock
 * call right after always recomputes the pool from real PAID orders across
 * every ticket type sharing the key, so it self-corrects either way.
 */
function CreateTicketTypeForm({
  batchId,
  onCreated,
}: {
  batchId: string;
  onCreated: (created: TicketType) => void;
}) {
  const { token } = useAdminAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [totalQuantity, setTotalQuantity] = useState('');
  const [fixedQuantity, setFixedQuantity] = useState('');
  const [maxQuantityPerOrder, setMaxQuantityPerOrder] = useState('');
  const [sharedStockKey, setSharedStockKey] = useState('');
  const [poolTotalQuantity, setPoolTotalQuantity] = useState('');
  const [maxGroupOrders, setMaxGroupOrders] = useState('');
  const [groupBundleTotalAmount, setGroupBundleTotalAmount] = useState('');
  const [requiresPasscode, setRequiresPasscode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    name.trim() !== '' &&
    price.trim() !== '' &&
    Number.isInteger(Number(price)) &&
    totalQuantity.trim() !== '' &&
    Number.isInteger(Number(totalQuantity)) &&
    Number(totalQuantity) >= 1;

  function reset() {
    setName('');
    setPrice('');
    setTotalQuantity('');
    setFixedQuantity('');
    setMaxQuantityPerOrder('');
    setSharedStockKey('');
    setPoolTotalQuantity('');
    setMaxGroupOrders('');
    setGroupBundleTotalAmount('');
    setRequiresPasscode(false);
  }

  async function handleCreate() {
    if (!token || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const dto: Parameters<typeof api.adminCreateTicketType>[2] = {
        name: name.trim(),
        price: Number(price),
        totalQuantity: Number(totalQuantity),
        requiresPasscode,
      };
      if (fixedQuantity.trim()) dto.fixedQuantity = Number(fixedQuantity);
      if (maxQuantityPerOrder.trim())
        dto.maxQuantityPerOrder = Number(maxQuantityPerOrder);
      if (sharedStockKey.trim()) dto.sharedStockKey = sharedStockKey.trim();
      if (poolTotalQuantity.trim()) dto.poolTotalQuantity = Number(poolTotalQuantity);
      if (maxGroupOrders.trim()) dto.maxGroupOrders = Number(maxGroupOrders);
      if (groupBundleTotalAmount.trim())
        dto.groupBundleTotalAmount = Number(groupBundleTotalAmount);

      const created = await api.adminCreateTicketType(token, batchId, dto);
      await api.adminResetStock(token);
      onCreated(created);
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '新增失敗');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="link-button" onClick={() => setOpen(true)}>
        ＋ 新增票種
      </button>
    );
  }

  return (
    <div className="admin-tickettype-create">
      <label>
        名稱
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        單價
        <input type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <label>
        總量
        <input
          type="number"
          min={1}
          value={totalQuantity}
          onChange={(e) => setTotalQuantity(e.target.value)}
        />
      </label>
      <label>
        固定張數（團體套票用，留空＝一般個人票）
        <input
          type="number"
          min={1}
          value={fixedQuantity}
          onChange={(e) => setFixedQuantity(e.target.value)}
        />
      </label>
      <label>
        每人單次限購張數（個人票用，留空＝1 張）
        <input
          type="number"
          min={1}
          value={maxQuantityPerOrder}
          onChange={(e) => setMaxQuantityPerOrder(e.target.value)}
        />
      </label>
      <label>
        共用票池 key（留空＝獨立庫存）
        <input
          value={sharedStockKey}
          onChange={(e) => setSharedStockKey(e.target.value)}
          placeholder="要跟哪個票種共用庫存，輸入相同的 key"
        />
      </label>
      <label>
        票池總量（與共用此 key 的其他票種必須一致）
        <input
          type="number"
          min={0}
          value={poolTotalQuantity}
          onChange={(e) => setPoolTotalQuantity(e.target.value)}
        />
      </label>
      <label>
        團體訂單組數上限（留空＝不限組數）
        <input
          type="number"
          min={0}
          value={maxGroupOrders}
          onChange={(e) => setMaxGroupOrders(e.target.value)}
        />
      </label>
      <label>
        套票固定總價（留空＝用單價×張數計算）
        <input
          type="number"
          min={0}
          value={groupBundleTotalAmount}
          onChange={(e) => setGroupBundleTotalAmount(e.target.value)}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={requiresPasscode}
          onChange={(e) => setRequiresPasscode(e.target.checked)}
        />
        需要通關密碼才能排隊
      </label>
      <div className="button-row">
        <button disabled={!valid || saving} onClick={handleCreate}>
          {saving ? '新增中…' : '建立票種'}
        </button>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
        >
          取消
        </button>
      </div>
      {error && <p className="error hint">{error}</p>}
    </div>
  );
}

function BatchRow({
  batch,
  onSaved,
  onTicketTypeSaved,
  onTicketTypeCreated,
  onDeleted,
}: {
  batch: SaleBatch;
  onSaved: (updated: SaleBatch) => void;
  onTicketTypeSaved: (updated: TicketType) => void;
  onTicketTypeCreated: (created: TicketType) => void;
  onDeleted: (batchId: string) => void;
}) {
  const { token } = useAdminAuth();
  const [startDraft, setStartDraft] = useState(isoToTaipeiInputValue(batch.saleStartAt));
  const [endDraft, setEndDraft] = useState(isoToTaipeiInputValue(batch.saleEndAt));
  const [transferEndDraft, setTransferEndDraft] = useState(
    isoToTaipeiInputValue(batch.transferEndAt),
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    startDraft !== isoToTaipeiInputValue(batch.saleStartAt) ||
    endDraft !== isoToTaipeiInputValue(batch.saleEndAt) ||
    transferEndDraft !== isoToTaipeiInputValue(batch.transferEndAt);

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.adminUpdateBatch(token, batch.id, {
        saleStartAt: taipeiInputValueToIso(startDraft),
        saleEndAt: taipeiInputValueToIso(endDraft),
        transferEndAt: taipeiInputValueToIso(transferEndDraft),
      });
      onSaved({ ...batch, ...updated });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!token) return;
    if (
      !window.confirm(
        `確定要永久刪除「${batch.name}」嗎？此操作無法復原。若此波次任何票種已有訂單，系統會拒絕刪除。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api.adminDeleteBatch(token, batch.id);
      onDeleted(batch.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '刪除失敗');
      setDeleting(false);
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
      <td data-label="轉讓截止">
        <input
          type="datetime-local"
          value={transferEndDraft}
          onChange={(e) => setTransferEndDraft(e.target.value)}
        />
        <p className="hint">目前：{formatTaipeiDisplay(batch.transferEndAt)}</p>
      </td>
      <td data-label="票種">
        <div className="admin-tickettype-list">
          {batch.ticketTypes.map((tt) => (
            <TicketTypeQuantityEditor key={tt.id} ticketType={tt} onSaved={onTicketTypeSaved} />
          ))}
          <CreateTicketTypeForm batchId={batch.id} onCreated={onTicketTypeCreated} />
        </div>
      </td>
      <td data-label="操作">
        <button disabled={!dirty || saving || deleting} onClick={handleSave}>
          {saving ? '儲存中…' : '儲存'}
        </button>
        <button
          className="danger-button"
          disabled={saving || deleting}
          onClick={handleDelete}
        >
          {deleting ? '刪除中…' : '刪除波次'}
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

  function removeBatchFromState(batchId: string) {
    setEvents(
      (prev) =>
        prev?.map((event) => ({
          ...event,
          sessions: event.sessions.map((session) => ({
            ...session,
            batches: session.batches.filter((b) => b.id !== batchId),
          })),
        })) ?? null,
    );
  }

  function addTicketTypeToState(batchId: string, created: TicketType) {
    setEvents(
      (prev) =>
        prev?.map((event) => ({
          ...event,
          sessions: event.sessions.map((session) => ({
            ...session,
            batches: session.batches.map((batch) =>
              batch.id !== batchId
                ? batch
                : { ...batch, ticketTypes: [...batch.ticketTypes, created] },
            ),
          })),
        })) ?? null,
    );
  }

  if (error) return <div className="page error">{error}</div>;
  if (!events) return <div className="page">載入中…</div>;

  return (
    <div className="page page-wide">
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
            <div key={session.id} className="admin-table-wrap is-fit">
              <h2>
                {event.name} — {session.venue}
              </h2>
              <table className="admin-table admin-table-cards is-fit">
                <thead>
                  <tr>
                    <th>波次</th>
                    <th>開賣時間</th>
                    <th>截止時間</th>
                    <th>轉讓截止</th>
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
                      onTicketTypeCreated={(created) => addTicketTypeToState(batch.id, created)}
                      onDeleted={removeBatchFromState}
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
