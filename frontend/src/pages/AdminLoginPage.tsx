import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAdminAuth } from '../context/AdminAuthContext';

export function AdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setToken } = useAdminAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // See LoginPage — the API client appends this when an authenticated call
  // 401s, to distinguish a lapsed session from a deliberate logout.
  const sessionExpired = new URLSearchParams(location.search).get('expired') === '1';

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
      {sessionExpired && <p className="error">登入已過期，請重新登入後再繼續。</p>}
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
