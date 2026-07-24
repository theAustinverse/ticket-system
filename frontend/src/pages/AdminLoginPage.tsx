import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';

export function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setToken } = useAdminAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await api.adminLogin(username, password);
      setToken(accessToken);
      navigate('/admin/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登入失敗，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1>後台管理登入</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          管理者帳號
          <input
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          密碼
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  );
}
