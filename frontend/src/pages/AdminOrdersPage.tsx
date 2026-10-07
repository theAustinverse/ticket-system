import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import { TEAM_OPTIONS } from '../constants';
import type {
  AdminOrderRow,
  AdminSeat,
  AdminTeamStat,
  GroupMember,
  OrderHistoryEntry,
} from '../api/types';

const HISTORY_ACTION_LABELS: Record<string, string> = {
  CREATED: '建立訂單',
  REGISTRANT_INFO_UPDATED: '編輯報名資訊',
  GROUP_MEMBERS_UPDATED: '編輯團員名單',
  CANCELLED: '取消訂單',
  TRANSFER_CREATED: '發起轉讓',
  TRANSFER_ACCEPTED: '接受轉讓',
  TRANSFER_REJECTED: '拒絕轉讓',
  TRANSFER_CANCELLED: '取消轉讓',
  ADMIN_NOTE_UPDATED: '後台備註',
  ADMIN_SEAT_EDITED: '後台改座位',
  ADMIN_TEAM_CHANGED: '後台改體系',
  ADMIN_CANCELLED: '後台取消訂單',
  CHECKED_IN: '現場報到',
  CHECK_IN_UNDONE: '撤銷報到',
};

/** Tolerates orders placed before this feature, which stored a plain member-name string. */
function memberName(member: GroupMember | string): string {
  return typeof member === 'string' ? member : member.name;
}
function memberContact(member: GroupMember | string): string {
  return typeof member === 'string' ? '' : member.contact;
}
function isMemberFilled(member: GroupMember | string): boolean {
  return !!memberName(member).trim();
}

/** How many of a group order's other-member seats are actually filled in, e.g. "8 / 10". */
function groupFillStatus(row: AdminOrderRow): { filled: number; total: number } | null {
  if (!row.groupMembers || row.groupMembers.length === 0) return null;
  const filled = row.groupMembers.filter(isMemberFilled).length;
  return { filled, total: row.groupMembers.length };
}

function companionFillStatus(row: AdminOrderRow): { filled: number; total: number } | null {
  if (!row.companions || row.companions.length === 0) return null;
  const filled = row.companions.filter((c) => !!c.name.trim()).length;
  return { filled, total: row.companions.length };
}

const MEAL_OPTIONS = ['葷食', '素食', '蛋奶素'];

/** Same person written two ways (spaces, full-width brackets) must still collide. */
function normalizeName(name: string | null): string {
  return (name ?? '').replace(/[\s\u3000]/g, '').replace(/[（(].*?[）)]/g, '');
}

/** A cancelled order's seats no longer count, so they're neither duplicates nor duplicated-against. */
function isActive(row: AdminOrderRow): boolean {
  return row.status === 'PAID' || row.status === 'PENDING';
}

function matchesQuery(row: AdminOrderRow, query: string): boolean {
  const haystack = [
    ...row.seats.map((seat) => seat.name),
    row.userEmail,
    row.registrantName,
    row.registrantTeam,
    row.registrantLineId,
    row.registrantPhone,
    row.mealPreference,
    row.ticketTypeName,
    row.status,
    row.id,
    row.adminNote,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function AdminOrdersPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<AdminOrderRow[] | null>(null);
  const [stats, setStats] = useState<AdminTeamStat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [opsMessage, setOpsMessage] = useState<string | null>(null);
  const [opsBusy, setOpsBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());
  const [historyData, setHistoryData] = useState<Record<string, OrderHistoryEntry[]>>({});
  const [historyLoading, setHistoryLoading] = useState<Set<string>>(new Set());
  const [onlyDuplicates, setOnlyDuplicates] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'CANCELLED'>('');
  const [seatEdit, setSeatEdit] = useState<{
    orderId: string;
    seatIndex: number;
    name: string;
    meal: string;
  } | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function toggleHistory(id: string) {
    setHistoryOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (!token || historyData[id]) return;
    setHistoryLoading((prev) => new Set(prev).add(id));
    try {
      const entries = await api.adminGetOrderHistory(token, id);
      setHistoryData((prev) => ({ ...prev, [id]: entries }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '載入歷程失敗');
    } finally {
      setHistoryLoading((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    Promise.all([api.adminListOrders(token), api.adminGetTeamStats(token)])
      .then(([orderRows, teamStats]) => {
        setRows(orderRows);
        setStats(teamStats);
        setNoteDrafts(
          Object.fromEntries(orderRows.map((r) => [r.id, r.adminNote ?? ''])),
        );
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入失敗'),
      );
  }, [token, navigate]);

  const teams = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => r.registrantTeam))),
    [rows],
  );

  // How many *active* seats carry each name, across every order — a name
  // seen twice is either a double purchase or a person listed under two
  // groups, and either way someone should look at it.
  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows ?? []) {
      if (!isActive(row)) continue;
      for (const seat of row.seats) {
        const key = normalizeName(seat.name);
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    return counts;
  }, [rows]);

  function isDuplicateSeat(row: AdminOrderRow, seat: AdminSeat): boolean {
    if (!isActive(row)) return false;
    return (nameCounts.get(normalizeName(seat.name)) ?? 0) > 1;
  }

  function duplicateCount(row: AdminOrderRow): number {
    return row.seats.filter((seat) => isDuplicateSeat(row, seat)).length;
  }

  const duplicateOrderCount = (rows ?? []).filter((r) => duplicateCount(r) > 0).length;

  const visibleRows = (rows ?? [])
    .filter((r) => !teamFilter || r.registrantTeam === teamFilter)
    .filter((r) => !statusFilter || (statusFilter === 'ACTIVE' ? isActive(r) : r.status === 'CANCELLED'))
    .filter((r) => !onlyDuplicates || duplicateCount(r) > 0)
    .filter((r) => !query.trim() || matchesQuery(r, query.trim()));

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) =>
      prev.size === visibleRows.length
        ? new Set()
        : new Set(visibleRows.map((r) => r.id)),
    );
  }

  async function handleBulkDeleteOrders() {
    if (!token || selected.size === 0) return;
    if (
      !window.confirm(
        `確定要刪除已勾選的 ${selected.size} 筆訂單嗎？此操作會釋放對應的票種庫存，無法復原。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.adminBulkDeleteOrders(token, Array.from(selected));
      setRows((prev) => prev?.filter((r) => !selected.has(r.id)) ?? null);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '刪除失敗');
    } finally {
      setDeleting(false);
    }
  }

  async function handleNoteBlur(row: AdminOrderRow) {
    if (!token) return;
    const draft = noteDrafts[row.id] ?? '';
    if (draft === (row.adminNote ?? '')) return;
    try {
      const updated = await api.adminUpdateOrderNote(token, row.id, draft);
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.id === row.id ? { ...r, adminNote: updated.adminNote } : r,
          ) ?? null,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '備註儲存失敗');
    }
  }

  async function handleSaveSeat() {
    if (!token || !seatEdit) return;
    const row = rows?.find((r) => r.id === seatEdit.orderId);
    const seat = row?.seats.find((x) => x.seatIndex === seatEdit.seatIndex);
    if (!row || !seat) return;
    const edit: { name?: string; mealPreference?: string } = {};
    if (seatEdit.name.trim() !== (seat.name ?? '')) edit.name = seatEdit.name.trim();
    if (seatEdit.meal.trim() !== (seat.mealPreference ?? '')) edit.mealPreference = seatEdit.meal.trim();
    if (Object.keys(edit).length === 0) {
      setSeatEdit(null);
      return;
    }
    setRowBusy(row.id);
    try {
      const saved = await api.adminUpdateSeat(token, row.id, seat.seatIndex, edit);
      setRows(
        (prev) =>
          prev?.map((r) =>
            r.id !== row.id
              ? r
              : {
                  ...r,
                  seats: r.seats.map((x) =>
                    x.seatIndex === saved.seatIndex
                      ? { ...x, name: saved.name, mealPreference: saved.mealPreference }
                      : x,
                  ),
                },
          ) ?? null,
      );
      // The cached history is now stale — drop it so the next open refetches.
      setHistoryData((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
      setSeatEdit(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改座位失敗');
    } finally {
      setRowBusy(null);
    }
  }

  async function handleChangeTeam(row: AdminOrderRow, team: string) {
    if (!token || !team || team === row.registrantTeam) return;
    const seatCount = row.seats.length;
    if (
      !window.confirm(
        `把這張訂單（${seatCount} 個座位）的體系從「${row.registrantTeam}」改成「${team}」？\n體系是整張訂單共用的，所有座位會一起移過去。`,
      )
    ) {
      return;
    }
    setRowBusy(row.id);
    try {
      await api.adminUpdateOrderTeam(token, row.id, team);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, registrantTeam: team } : r)) ?? null);
      setStats(await api.adminGetTeamStats(token));
      setHistoryData((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改體系失敗');
    } finally {
      setRowBusy(null);
    }
  }

  async function handleCancelOrder(row: AdminOrderRow) {
    if (!token) return;
    const names = row.seats.map((s) => s.name || '未填').join('、');
    if (
      !window.confirm(
        `確定要取消這張訂單嗎？\n\n${row.registrantName}｜${row.ticketTypeName}｜${row.quantity} 張\n${names}\n\n票會回到庫存，訂單與紀錄會保留。系統不會退款，退費請自行處理。`,
      )
    ) {
      return;
    }
    setRowBusy(row.id);
    try {
      await api.adminCancelOrder(token, row.id);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, status: 'CANCELLED' } : r)) ?? null);
      setStats(await api.adminGetTeamStats(token));
      setHistoryData((prev) => {
        const next = { ...prev };
        delete next[row.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '取消訂單失敗');
    } finally {
      setRowBusy(null);
    }
  }

  async function handleResetStock() {
    if (!token) return;
    if (!confirm('確定要把所有票種的庫存重置回原始總量嗎？（用於壓力測試前後）')) return;
    setOpsBusy(true);
    setOpsMessage(null);
    try {
      const result = await api.adminResetStock(token);
      setOpsMessage(`已重置 ${result.length} 個票種的庫存`);
    } catch (err) {
      setOpsMessage(err instanceof ApiError ? err.message : '重置失敗');
    } finally {
      setOpsBusy(false);
    }
  }

  async function handleDeleteLoadTestUsers() {
    if (!token) return;
    if (!confirm('確定要刪除所有 loadtest 開頭的測試帳號與其訂單嗎？')) return;
    setOpsBusy(true);
    setOpsMessage(null);
    try {
      const result = await api.adminDeleteLoadTestUsers(token);
      setOpsMessage(`已刪除 ${result.deleted} 個測試帳號`);
    } catch (err) {
      setOpsMessage(err instanceof ApiError ? err.message : '刪除失敗');
    } finally {
      setOpsBusy(false);
    }
  }

  async function handleExport() {
    if (!token) return;
    setExporting(true);
    try {
      await api.adminExportOrders(token, teamFilter || undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '匯出失敗');
    } finally {
      setExporting(false);
    }
  }

  if (error) return <div className="page error">{error}</div>;
  if (!rows || !stats) return <div className="page">載入中…</div>;

  return (
    <div className="page page-wide">
      <Link to="/admin/dashboard" className="link-button">
        ← 返回後台選單
      </Link>
      <h1>訂單管理</h1>

      <h2>各體系訂票排名（依張數，佔總體訂票數比例；含 PAID + PENDING）</h2>
      <div className="admin-table-wrap admin-stats-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>所屬體系/系統</th>
              <th>訂票張數</th>
              <th>佔比</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.team}>
                <td>#{s.rank}</td>
                <td>{s.team}</td>
                <td>{s.ticketCount}</td>
                <td>{s.percentage.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>維運工具（壓力測試用）</h2>
      <div className="admin-toolbar">
        <button onClick={handleResetStock} disabled={opsBusy}>
          重置票種庫存
        </button>
        <button onClick={handleDeleteLoadTestUsers} disabled={opsBusy}>
          刪除 loadtest 測試帳號
        </button>
        {opsMessage && <span className="hint">{opsMessage}</span>}
      </div>

      <h2>所有訂單</h2>
      <div className="admin-toolbar">
        <button onClick={handleExport} disabled={exporting}>
          {exporting
            ? '匯出中…'
            : teamFilter
              ? `匯出「${teamFilter}」訂單 Excel`
              : '匯出訂單 Excel'}
        </button>
        <button
          className="danger-button"
          disabled={selected.size === 0 || deleting}
          onClick={handleBulkDeleteOrders}
        >
          {deleting ? '刪除中…' : `刪除已選取（${selected.size}）`}
        </button>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">所有體系</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | 'ACTIVE' | 'CANCELLED')}
        >
          <option value="">所有狀態</option>
          <option value="ACTIVE">有效（已付款／待付款）</option>
          <option value="CANCELLED">已取消</option>
        </select>
        <label className="admin-inline-check">
          <input
            type="checkbox"
            checked={onlyDuplicates}
            onChange={(e) => setOnlyDuplicates(e.target.checked)}
          />
          只看同名重複（{duplicateOrderCount} 張訂單）
        </label>
        <div className="admin-search">
          <button
            type="button"
            className="icon-button"
            aria-label="搜尋"
            onClick={() => setSearchOpen((v) => !v)}
          >
            🔍
          </button>
          {searchOpen && (
            <input
              autoFocus
              placeholder="搜尋座位姓名／email／團隊／LINE／電話／票種…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
      </div>

      {(query.trim() || teamFilter || statusFilter || onlyDuplicates) && (
        <p className="hint">找到 {visibleRows.length} 筆結果</p>
      )}

      <div className="admin-table-wrap">
        {/* admin-table-cards: below 768px this table reflows from a 14-column
            grid into one card per order — see styles.css. Each td carries a
            data-label that becomes its row heading once the thead is hidden. */}
        <table className="admin-table admin-table-cards">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    visibleRows.length > 0 &&
                    selected.size === visibleRows.length
                  }
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Email</th>
              <th>姓名</th>
              <th>聯絡資訊</th>
              <th>所屬體系/系統</th>
              <th>用餐需求</th>
              <th>票種</th>
              <th>張數</th>
              <th>團體/親友名單</th>
              <th>狀態</th>
              <th>訂購時間</th>
              <th>訂票編號</th>
              <th>備註</th>
              <th>歷程</th>
            </tr>
          </thead>
          {visibleRows.map((row) => {
              const groupStatus = groupFillStatus(row);
              const companionStatus = companionFillStatus(row);
              const isOpen = expanded.has(row.id);
              const isHistoryOpen = historyOpen.has(row.id);
              const isHistoryLoading = historyLoading.has(row.id);
              return (
              <tbody key={row.id}>
              <tr>
                <td data-label="選取">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelected(row.id)}
                  />
                </td>
                <td data-label="Email">{row.userEmail}</td>
                <td data-label="姓名">
                  {row.registrantName}
                  {duplicateCount(row) > 0 && (
                    <span className="admin-dup-badge" title="這張訂單有座位的姓名在其他座位也出現">
                      同名重複 {duplicateCount(row)}
                    </span>
                  )}
                </td>
                <td data-label="聯絡資訊">
                  LINE: {row.registrantLineId}
                  <br />
                  電話: {row.registrantPhone}
                </td>
                <td data-label="所屬體系/系統">{row.registrantTeam}</td>
                <td data-label="用餐需求">{row.mealPreference}</td>
                <td data-label="票種">{row.ticketTypeName}</td>
                <td data-label="張數">{row.quantity}</td>
                <td data-label="團體/親友名單">
                  <button
                    type="button"
                    className={`admin-expand-toggle ${
                      !(groupStatus ?? companionStatus) ||
                      (groupStatus ?? companionStatus)!.filled === (groupStatus ?? companionStatus)!.total
                        ? 'admin-fill-complete'
                        : 'admin-fill-incomplete'
                    }`}
                    onClick={() => toggleExpanded(row.id)}
                  >
                    {groupStatus
                      ? `團員 ${groupStatus.filled}/${groupStatus.total}`
                      : companionStatus
                        ? `親友 ${companionStatus.filled}/${companionStatus.total}`
                        : `座位 ${row.quantity}`}
                    {isOpen ? ' ▲' : ' ▼'}
                  </button>
                </td>
                <td data-label="狀態">
                  <span className="badge">{row.status}</span>
                </td>
                <td data-label="訂購時間">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="admin-table-id" data-label="訂票編號">{row.id}</td>
                <td data-label="備註">
                  <input
                    className="admin-note-input"
                    value={noteDrafts[row.id] ?? ''}
                    onChange={(e) =>
                      setNoteDrafts((prev) => ({
                        ...prev,
                        [row.id]: e.target.value,
                      }))
                    }
                    onBlur={() => handleNoteBlur(row)}
                  />
                </td>
                <td data-label="歷程">
                  <button
                    type="button"
                    className="admin-expand-toggle"
                    onClick={() => toggleHistory(row.id)}
                  >
                    歷程 {isHistoryOpen ? ' ▲' : ' ▼'}
                  </button>
                </td>
              </tr>
              {isHistoryOpen && (
                <tr className="admin-group-detail-row">
                  <td />
                  <td colSpan={12}>
                    <div className="admin-group-detail">
                      {isHistoryLoading && <p className="hint">載入中…</p>}
                      {!isHistoryLoading && (historyData[row.id]?.length ?? 0) === 0 && (
                        <p className="hint">尚無變更紀錄</p>
                      )}
                      {!isHistoryLoading && (historyData[row.id]?.length ?? 0) > 0 && (
                        <table className="admin-subtable">
                          <thead>
                            <tr>
                              <th>時間</th>
                              <th>動作</th>
                              <th>操作者</th>
                              <th>變更前</th>
                              <th>變更後</th>
                            </tr>
                          </thead>
                          <tbody>
                            {historyData[row.id]!.map((entry) => (
                              <tr key={entry.id}>
                                <td>{new Date(entry.createdAt).toLocaleString()}</td>
                                <td>{HISTORY_ACTION_LABELS[entry.action] ?? entry.action}</td>
                                <td>{entry.actorLabel}</td>
                                <td>
                                  <pre className="admin-history-json">
                                    {entry.before ? JSON.stringify(entry.before, null, 2) : '—'}
                                  </pre>
                                </td>
                                <td>
                                  <pre className="admin-history-json">
                                    {entry.after ? JSON.stringify(entry.after, null, 2) : '—'}
                                  </pre>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </td>
                </tr>
              )}
              {isOpen && (
                <tr className="admin-group-detail-row">
                  <td />
                  <td colSpan={12}>
                    <div className="admin-group-detail">
                      {row.groupLeaderName && (
                        <p className="hint">
                          主揪：{row.groupLeaderName} · LINE: {row.groupLeaderLineId} · 電話:{' '}
                          {row.groupLeaderPhone}
                        </p>
                      )}
                      <div className="admin-seat-actions">
                        <label>
                          體系（整張訂單共用）{' '}
                          <select
                            value={row.registrantTeam}
                            disabled={rowBusy === row.id || row.status === 'CANCELLED'}
                            onChange={(e) => handleChangeTeam(row, e.target.value)}
                          >
                            {!TEAM_OPTIONS.includes(row.registrantTeam as never) && (
                              <option value={row.registrantTeam}>{row.registrantTeam}（不在清單）</option>
                            )}
                            {TEAM_OPTIONS.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </label>
                        {isActive(row) && (
                          <button
                            type="button"
                            className="danger-button"
                            disabled={rowBusy === row.id}
                            onClick={() => handleCancelOrder(row)}
                          >
                            取消這張訂單
                          </button>
                        )}
                      </div>
                      <table className="admin-subtable">
                        <thead>
                          <tr>
                            <th>#</th>
                            <th>姓名</th>
                            <th>身分</th>
                            <th>用餐需求</th>
                            <th>聯絡／備註</th>
                            <th>報到</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {row.seats.map((seat) => {
                            const editing =
                              seatEdit?.orderId === row.id && seatEdit.seatIndex === seat.seatIndex;
                            const member = row.groupMembers?.[seat.seatIndex - 1];
                            const companionIndex = row.buyingForFamily ? seat.seatIndex : seat.seatIndex - 1;
                            const companion = row.companions?.[companionIndex];
                            const detail = row.groupMembers
                              ? seat.seatIndex === 0
                                ? row.groupLeaderPhone ?? ''
                                : member
                                  ? memberContact(member)
                                  : ''
                              : seat.role === 'COMPANION' && companion
                                ? [companion.relationship, companion.note].filter(Boolean).join('／')
                                : '';
                            const dup = isDuplicateSeat(row, seat);
                            return (
                              <tr key={seat.seatIndex} className={seat.name ? '' : 'admin-detail-blank'}>
                                <td>{seat.seatIndex + 1}</td>
                                <td>
                                  {editing ? (
                                    <input
                                      autoFocus
                                      value={seatEdit.name}
                                      maxLength={50}
                                      onChange={(e) => setSeatEdit({ ...seatEdit, name: e.target.value })}
                                    />
                                  ) : (
                                    <>
                                      {seat.name || '未填寫'}
                                      {dup && (
                                        <span className="admin-dup-badge" title="這個姓名在其他座位也出現">
                                          同名重複
                                        </span>
                                      )}
                                    </>
                                  )}
                                </td>
                                <td>{seat.relation ?? (seat.role === 'SELF' ? '本人' : seat.role === 'COMPANION' ? '同行親友' : '—')}</td>
                                <td>
                                  {editing ? (
                                    <>
                                      <input
                                        list="admin-meal-options"
                                        value={seatEdit.meal}
                                        maxLength={50}
                                        onChange={(e) => setSeatEdit({ ...seatEdit, meal: e.target.value })}
                                      />
                                      <datalist id="admin-meal-options">
                                        {MEAL_OPTIONS.map((m) => (
                                          <option key={m} value={m} />
                                        ))}
                                      </datalist>
                                    </>
                                  ) : (
                                    seat.mealPreference || '未填寫'
                                  )}
                                </td>
                                <td>{detail || '—'}</td>
                                <td>{seat.checkedInAt ? '已報到' : '—'}</td>
                                <td>
                                  {row.status === 'CANCELLED' ? null : editing ? (
                                    <>
                                      <button
                                        type="button"
                                        className="admin-expand-toggle"
                                        disabled={rowBusy === row.id || !seatEdit.name.trim()}
                                        onClick={handleSaveSeat}
                                      >
                                        儲存
                                      </button>{' '}
                                      <button
                                        type="button"
                                        className="admin-expand-toggle"
                                        onClick={() => setSeatEdit(null)}
                                      >
                                        取消
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="admin-expand-toggle"
                                      onClick={() =>
                                        setSeatEdit({
                                          orderId: row.id,
                                          seatIndex: seat.seatIndex,
                                          name: seat.name ?? '',
                                          meal: seat.mealPreference ?? '',
                                        })
                                      }
                                    >
                                      修改
                                    </button>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
              </tbody>
              );
            })}
        </table>
      </div>
    </div>
  );
}
