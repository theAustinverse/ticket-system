import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type { AdminHelpItem } from '../api/types';

type Filter = '' | 'ESCALATED' | 'ADMIN_ANSWERED' | 'BOT_ANSWERED';

const STATUS_LABEL: Record<AdminHelpItem['status'], string> = {
  ESCALATED: '待回覆',
  ADMIN_ANSWERED: '已回覆',
  BOT_ANSWERED: '小幫手已答',
};

export function AdminHelpPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('ESCALATED');
  const [items, setItems] = useState<AdminHelpItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load(authToken: string, f: Filter) {
    return api
      .adminListHelp(authToken, f || undefined)
      .then(setItems)
      .catch((err) => setError(err instanceof ApiError ? err.message : '載入失敗'));
  }

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    load(token, filter);
  }, [token, filter, navigate]);

  async function run(id: string, action: () => Promise<unknown>) {
    if (!token) return;
    setBusyId(id);
    setError(null);
    try {
      await action();
      await load(token, filter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '操作失敗');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="page">
      <p>
        <Link to="/admin/dashboard">← 回後台</Link>
      </p>
      <h1>客服小幫手問題</h1>
      <p className="hint">
        小幫手答不出來的問題會出現在「待回覆」，並寄信通知你。你回覆後，使用者會在自己的小幫手視窗看到。
      </p>
      <div className="admin-filter-row">
        {(
          [
            ['ESCALATED', '待回覆'],
            ['ADMIN_ANSWERED', '已回覆'],
            ['BOT_ANSWERED', '小幫手已答'],
            ['', '全部'],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <button
            key={value || 'all'}
            type="button"
            className={filter === value ? '' : 'secondary'}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="hint">載入中…</p>}
      {items?.length === 0 && <p className="hint">沒有符合的問題。</p>}
      {items?.map((it) => (
        <div key={it.id} className="admin-help-card">
          <div className="admin-help-meta">
            <strong>{it.askerName}</strong>（{it.user.email}）·{' '}
            {new Date(it.createdAt).toLocaleString('zh-TW')} ·{' '}
            <span className={`admin-help-status admin-help-${it.status}`}>
              {STATUS_LABEL[it.status]}
            </span>
          </div>
          <p className="admin-help-q">{it.question}</p>
          {it.botAnswer && <p className="hint">小幫手回答：{it.botAnswer}</p>}
          {it.adminReply && <p className="admin-help-reply">你的回覆：{it.adminReply}</p>}
          <textarea
            rows={2}
            maxLength={2000}
            placeholder={it.adminReply ? '修改回覆…' : '輸入回覆…'}
            value={drafts[it.id] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [it.id]: e.target.value }))}
          />
          <div className="admin-help-actions">
            <button
              type="button"
              disabled={busyId === it.id || !(drafts[it.id] ?? '').trim()}
              onClick={() =>
                run(it.id, async () => {
                  await api.adminReplyHelp(token!, it.id, drafts[it.id].trim());
                  setDrafts((d) => ({ ...d, [it.id]: '' }));
                })
              }
            >
              送出回覆
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busyId === it.id}
              onClick={() => {
                if (window.confirm('刪除這則問題？')) {
                  run(it.id, () => api.adminDeleteHelp(token!, it.id));
                }
              }}
            >
              刪除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
