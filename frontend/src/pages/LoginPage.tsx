import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const location = useLocation();
  const initialMode =
    (location.state as { mode?: 'login' | 'register' } | null)?.mode ?? 'login';
  const [mode, setMode] = useState<'login' | 'register' | 'verify'>(initialMode);

  // The navbar's 登入/註冊 links both point to "/login", so React Router only
  // re-renders (not remounts) between them — the useState initializer above
  // never re-runs on that second navigation. Re-sync explicitly whenever the
  // location actually changes (location.key is unique per navigation, even
  // to the same path).
  useEffect(() => {
    const nextMode =
      (location.state as { mode?: 'login' | 'register' } | null)?.mode ?? 'login';
    setMode(nextMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { setToken } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'register' && password !== confirmPassword) {
      setError('兩次輸入的密碼不一致，請重新確認');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        const { accessToken } = await api.login(email, password);
        setToken(accessToken);
        navigate('/events');
      } else if (mode === 'register') {
        await api.register(email, password);
        setMode('verify');
      } else {
        const { accessToken } = await api.verifyRegistration(email, code);
        setToken(accessToken);
        navigate('/profile', { state: { from: '/events' } });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '發生錯誤，請稍後再試');
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'verify') {
    return (
      <div className="page page-narrow">
        <h1>驗證信箱</h1>
        <p className="hint">
          驗證碼已寄到 {email}，請至信箱收取後輸入以下六位數驗證碼
        </p>
        <form onSubmit={handleSubmit} className="form">
          <label>
            驗證碼
            <input
              required
              minLength={6}
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? '驗證中…' : '完成註冊'}
          </button>
        </form>
        <button className="link-button" onClick={() => setMode('register')}>
          返回上一步
        </button>
      </div>
    );
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
        {mode === 'register' && (
          <p className="hint">僅接受 @gmail.com 結尾的信箱</p>
        )}
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
        {mode === 'register' && (
          <label>
            確認密碼
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '處理中…' : mode === 'login' ? '登入' : '下一步：寄送驗證碼'}
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
