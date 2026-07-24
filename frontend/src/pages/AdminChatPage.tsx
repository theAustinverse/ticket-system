import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';
import { decodeJwtRole } from '../jwt';
import type { ChatMessage } from '../api/types';

export function AdminChatPage() {
  const { token } = useAdminAuth();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!token || decodeJwtRole(token) !== 'ADMIN') {
      navigate('/admin/login');
      return;
    }
    api
      .listChatMessages(token)
      .then(setMessages)
      .catch((err) => setError(err instanceof ApiError ? err.message : '載入失敗'));
  }, [token, navigate]);

  async function handleDelete(id: string) {
    if (!token) return;
    if (!confirm('確定要刪除這則留言嗎？')) return;
    setDeletingId(id);
    try {
      await api.adminDeleteChatMessage(token, id);
      setMessages((prev) => prev?.filter((m) => m.id !== id) ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '刪除失敗');
    } finally {
      setDeletingId(null);
    }
  }

  if (error) return <div className="page error">{error}</div>;
  if (!messages) return <div className="page">載入中…</div>;

  return (
    <div className="page">
      <Link to="/admin/dashboard" className="link-button">
        ← 返回後台選單
      </Link>
      <h1>心情便利貼管理</h1>
      {messages.length === 0 && <p>目前沒有任何留言</p>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>留言者</th>
              <th>內容</th>
              <th>時間</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td>{m.authorName}</td>
                <td>{m.content}</td>
                <td>{new Date(m.createdAt).toLocaleString()}</td>
                <td>
                  <button
                    className="danger-button"
                    disabled={deletingId === m.id}
                    onClick={() => handleDelete(m.id)}
                  >
                    {deletingId === m.id ? '刪除中…' : '刪除'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
