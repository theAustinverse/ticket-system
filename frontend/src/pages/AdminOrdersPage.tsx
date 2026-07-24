import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type { AdminOrderRow, AdminTeamStat, Companion, GroupMember } from '../api/types';

/** Tolerates orders placed before this feature, which stored a plain member-name string. */
function memberName(member: GroupMember | string): string {
  return typeof member === 'string' ? member : member.name;
}
function memberContact(member: GroupMember | string): string {
  return typeof member === 'string' ? '' : member.contact;
}
function memberMeal(member: GroupMember | string): string {
  return typeof member === 'string' ? '' : member.mealPreference;
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

function matchesQuery(row: AdminOrderRow, query: string): boolean {
  const haystack = [
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

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  const visibleRows = (rows ?? [])
    .filter((r) => !teamFilter || r.registrantTeam === teamFilter)
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
              placeholder="搜尋 email／姓名／團隊／LINE／電話／票種…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
      </div>

      {(query.trim() || teamFilter) && (
        <p className="hint">找到 {visibleRows.length} 筆結果</p>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
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
            </tr>
          </thead>
          {visibleRows.map((row) => {
              const groupStatus = groupFillStatus(row);
              const companionStatus = companionFillStatus(row);
              const isOpen = expanded.has(row.id);
              return (
              <tbody key={row.id}>
              <tr>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    onChange={() => toggleSelected(row.id)}
                  />
                </td>
                <td>{row.userEmail}</td>
                <td>{row.registrantName}</td>
                <td>
                  LINE: {row.registrantLineId}
                  <br />
                  電話: {row.registrantPhone}
                </td>
                <td>{row.registrantTeam}</td>
                <td>{row.mealPreference}</td>
                <td>{row.ticketTypeName}</td>
                <td>{row.quantity}</td>
                <td>
                  {(groupStatus || companionStatus) ? (
                    <button
                      type="button"
                      className={`admin-expand-toggle ${
                        (groupStatus ?? companionStatus)!.filled ===
                        (groupStatus ?? companionStatus)!.total
                          ? 'admin-fill-complete'
                          : 'admin-fill-incomplete'
                      }`}
                      onClick={() => toggleExpanded(row.id)}
                    >
                      {groupStatus ? '團員' : '親友'} {groupStatus?.filled ?? companionStatus?.filled}/
                      {groupStatus?.total ?? companionStatus?.total}
                      {isOpen ? ' ▲' : ' ▼'}
                    </button>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>
                  <span className="badge">{row.status}</span>
                </td>
                <td>{new Date(row.createdAt).toLocaleString()}</td>
                <td className="admin-table-id">{row.id}</td>
                <td>
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
              </tr>
              {isOpen && (groupStatus || companionStatus) && (
                <tr className="admin-group-detail-row">
                  <td />
                  <td colSpan={11}>
                    <div className="admin-group-detail">
                      {row.groupLeaderName && (
                        <p className="hint">
                          主揪：{row.groupLeaderName} · LINE: {row.groupLeaderLineId} · 電話:{' '}
                          {row.groupLeaderPhone}
                        </p>
                      )}
                      {row.groupMembers && row.groupMembers.length > 0 && (
                        <table className="admin-subtable">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>姓名</th>
                              <th>聯絡方式</th>
                              <th>用餐需求</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.groupMembers.map((m, i) => (
                              <tr
                                key={i}
                                className={isMemberFilled(m) ? '' : 'admin-detail-blank'}
                              >
                                <td>{i + 1}</td>
                                <td>{memberName(m) || '未填寫'}</td>
                                <td>{memberContact(m) || '未填寫'}</td>
                                <td>{memberMeal(m) || '未填寫'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {row.companions && row.companions.length > 0 && (
                        <table className="admin-subtable">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>姓名</th>
                              <th>關係</th>
                              <th>用餐需求</th>
                              <th>備註</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.companions.map((c: Companion, i: number) => (
                              <tr key={i} className={c.name.trim() ? '' : 'admin-detail-blank'}>
                                <td>{i + 1}</td>
                                <td>{c.name || '未填寫'}</td>
                                <td>{c.relationship}</td>
                                <td>{c.mealPreference || '未填寫'}</td>
                                <td>{c.note}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
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
