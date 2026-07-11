import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setToken } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register(email, password);
      setToken(accessToken);
      navigate('/events');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '發生錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1>{mode === 'login' ? '登入' : '註冊'}</h1>
      <form onSubmit={handleSubmit} className="form">
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          密碼
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '處理中…' : mode === 'login' ? '登入' : '註冊'}
        </button>
      </form>
      <button
        className="link-button"
        onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
      >
        {mode === 'login' ? '還沒有帳號？註冊' : '已經有帳號？登入'}
      </button>
    </div>
  );
}
