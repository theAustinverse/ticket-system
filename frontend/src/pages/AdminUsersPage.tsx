import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type { AdminUser } from '../api/types';

function matchesQuery(user: AdminUser, query: string): boolean {
  const haystack = [user.email, user.name, user.team, user.lineId, user.phone]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function AdminUsersPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    api
      .adminListUsers(token)
      .then(setUsers)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入失敗'),
      );
  }, [token, navigate]);

  const teams = useMemo(
    () =>
      Array.from(new Set((users ?? []).map((u) => u.team).filter(Boolean))) as string[],
    [users],
  );

  /** Per-team registered-account counts (unfilled team lands in "未填寫"), descending by count. */
  const teamCounts = useMemo(() => {
    const totals = new Map<string, number>();
    for (const u of users ?? []) {
      const key = u.team ?? '未填寫';
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }
    return Array.from(totals.entries())
      .map(([team, count]) => ({ team, count }))
      .sort((a, b) => b.count - a.count);
  }, [users]);

  const visibleUsers = (users ?? [])
    .filter((u) => !teamFilter || u.team === teamFilter)
    .filter((u) => !query.trim() || matchesQuery(u, query.trim()));

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
      prev.size === visibleUsers.length
        ? new Set()
        : new Set(visibleUsers.map((u) => u.id)),
    );
  }

  async function handleBulkDelete() {
    if (!token || selected.size === 0) return;
    if (
      !window.confirm(
        `確定要刪除已勾選的 ${selected.size} 個帳號嗎？此操作會一併刪除他們所有的訂單並釋放庫存，無法復原。`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.adminBulkDeleteUsers(token, Array.from(selected));
      setUsers((prev) => prev?.filter((u) => !selected.has(u.id)) ?? null);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '刪除失敗');
    } finally {
      setDeleting(false);
    }
  }

  if (error) return <div className="page error">{error}</div>;
  if (!users) return <div className="page">載入中…</div>;

  return (
    <div className="page page-wide">
      <Link to="/admin/dashboard" className="link-button">
        ← 返回後台選單
      </Link>
      <h1>使用者帳號管理</h1>

      <h2>系統總註冊人數：{users.length} 人</h2>
      <div className="admin-table-wrap admin-stats-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>所屬體系/系統</th>
              <th>註冊人數</th>
              <th>佔比</th>
            </tr>
          </thead>
          <tbody>
            {teamCounts.map((s) => (
              <tr key={s.team}>
                <td>{s.team}</td>
                <td>{s.count}</td>
                <td>{users.length > 0 ? ((s.count / users.length) * 100).toFixed(1) : '0.0'}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-toolbar">
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
          <option value="">所有體系</option>
          {teams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button
          className="danger-button"
          disabled={selected.size === 0 || deleting}
          onClick={handleBulkDelete}
        >
          {deleting ? '刪除中…' : `刪除已選取（${selected.size}）`}
        </button>
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
              placeholder="搜尋 email／姓名／LINE／電話…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
        </div>
      </div>

      {(query.trim() || teamFilter) && (
        <p className="hint">找到 {visibleUsers.length} 筆結果</p>
      )}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  checked={
                    visibleUsers.length > 0 &&
                    selected.size === visibleUsers.length
                  }
                  onChange={toggleSelectAll}
                />
              </th>
              <th>Email</th>
              <th>姓名</th>
              <th>聯絡資訊</th>
              <th>所屬體系/系統</th>
              <th>角色</th>
              <th>註冊時間</th>
            </tr>
          </thead>
          <tbody>
            {visibleUsers.map((user) => (
              <tr key={user.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(user.id)}
                    onChange={() => toggleSelected(user.id)}
                  />
                </td>
                <td>{user.email}</td>
                <td>{user.name ?? '未填寫'}</td>
                <td>
                  LINE: {user.lineId ?? '未填寫'}
                  <br />
                  電話: {user.phone ?? '未填寫'}
                </td>
                <td>{user.team ?? '未填寫'}</td>
                <td>
                  <span className="badge">{user.role}</span>
                </td>
                <td>{new Date(user.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
