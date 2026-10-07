import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type { Contact } from '../api/types';

interface Draft {
  name: string;
  lineId: string;
  email: string;
  sortOrder: string;
}

const EMPTY: Draft = { name: '', lineId: '', email: '', sortOrder: '' };

function toDraft(c: Contact): Draft {
  return {
    name: c.name,
    lineId: c.lineId ?? '',
    email: c.email ?? '',
    sortOrder: String(c.sortOrder),
  };
}

export function AdminContactsPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<Draft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft>(EMPTY);

  function load(authToken: string) {
    return api
      .adminListContacts(authToken)
      .then(setContacts)
      .catch((err) => setError(err instanceof ApiError ? err.message : '載入失敗'));
  }

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    load(token);
  }, [token, navigate]);

  /** Runs a write, reloads the list, and shows the server's own reason on failure instead of a generic one. */
  async function run(action: () => Promise<unknown>, done: string) {
    if (!token) return false;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await load(token);
      setNotice(done);
      return true;
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : '操作失敗');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd() {
    if (!token) return;
    const ok = await run(
      () =>
        api.adminCreateContact(token, {
          name: adding.name.trim(),
          lineId: adding.lineId.trim() || undefined,
          email: adding.email.trim() || undefined,
          sortOrder: adding.sortOrder.trim() === '' ? undefined : Number(adding.sortOrder),
        }),
      '已新增',
    );
    if (ok) setAdding(EMPTY);
  }

  async function handleSave(id: string) {
    if (!token) return;
    const ok = await run(
      () =>
        api.adminUpdateContact(token, id, {
          name: editing.name.trim(),
          lineId: editing.lineId.trim(),
          email: editing.email.trim(),
          sortOrder: editing.sortOrder.trim() === '' ? undefined : Number(editing.sortOrder),
        }),
      '已儲存',
    );
    if (ok) setEditingId(null);
  }

  async function handleDelete(c: Contact) {
    if (!token) return;
    if (!confirm(`確定要刪除「${c.name}」嗎？前台會立即不再顯示。`)) return;
    await run(() => api.adminDeleteContact(token, c.id), '已刪除');
  }

  if (error) return <div className="page error">{error}</div>;
  if (!contacts) return <div className="page">載入中…</div>;

  return (
    <div className="page">
      <Link to="/admin/dashboard" className="link-button">
        ← 返回後台選單
      </Link>
      <h1>聯絡窗口管理</h1>
      <p className="hint">
        這裡填的資料會公開顯示在首頁和「聯絡我們」頁，任何訪客都看得到。LINE 欄位可填 LINE ID，或 https:// 開頭的連結；LINE 和 Email 至少填一個。排序數字小的排前面。
      </p>
      {notice && <p className="hint">{notice}</p>}

      <h2>新增窗口</h2>
      <div className="admin-toolbar">
        <input
          placeholder="姓名或稱呼（例：行政組 小美）"
          value={adding.name}
          maxLength={50}
          onChange={(e) => setAdding({ ...adding, name: e.target.value })}
        />
        <input
          placeholder="LINE ID 或 https 連結"
          value={adding.lineId}
          maxLength={200}
          onChange={(e) => setAdding({ ...adding, lineId: e.target.value })}
        />
        <input
          placeholder="Email"
          type="email"
          value={adding.email}
          maxLength={200}
          onChange={(e) => setAdding({ ...adding, email: e.target.value })}
        />
        <input
          placeholder="排序（可空白）"
          inputMode="numeric"
          value={adding.sortOrder}
          onChange={(e) => setAdding({ ...adding, sortOrder: e.target.value.replace(/\D/g, '') })}
          style={{ maxWidth: '8rem' }}
        />
        <button onClick={handleAdd} disabled={busy || !adding.name.trim() || (!adding.lineId.trim() && !adding.email.trim())}>
          新增
        </button>
      </div>

      <h2>目前窗口（{contacts.length}）</h2>
      {contacts.length === 0 && <p>還沒有聯絡窗口，前台目前不會顯示這個區塊。</p>}
      {contacts.length > 0 && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>排序</th>
                <th>姓名或稱呼</th>
                <th>LINE</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) =>
                editingId === c.id ? (
                  <tr key={c.id}>
                    <td>
                      <input
                        value={editing.sortOrder}
                        inputMode="numeric"
                        style={{ maxWidth: '5rem' }}
                        onChange={(e) => setEditing({ ...editing, sortOrder: e.target.value.replace(/\D/g, '') })}
                      />
                    </td>
                    <td>
                      <input value={editing.name} maxLength={50} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    </td>
                    <td>
                      <input value={editing.lineId} maxLength={200} onChange={(e) => setEditing({ ...editing, lineId: e.target.value })} />
                    </td>
                    <td>
                      <input value={editing.email} maxLength={200} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
                    </td>
                    <td>
                      <button disabled={busy || !editing.name.trim()} onClick={() => handleSave(c.id)}>
                        儲存
                      </button>{' '}
                      <button disabled={busy} onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={c.id}>
                    <td>{c.sortOrder}</td>
                    <td>{c.name}</td>
                    <td>{c.lineId ?? '—'}</td>
                    <td>{c.email ?? '—'}</td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() => {
                          setEditingId(c.id);
                          setEditing(toDraft(c));
                        }}
                      >
                        編輯
                      </button>{' '}
                      <button className="danger-button" disabled={busy} onClick={() => handleDelete(c)}>
                        刪除
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
