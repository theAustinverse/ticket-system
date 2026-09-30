import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError, CHECKIN_TOKEN_KEY } from '../api/client';

export function CheckinLoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const expired = new URLSearchParams(location.search).get('expired') === '1';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [staffName, setStaffName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { accessToken } = await api.checkinLogin(username, password, staffName.trim());
      localStorage.setItem(CHECKIN_TOKEN_KEY, accessToken);
      navigate('/checkin');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? err.message === 'Check-in login is not configured'
            ? '報到帳號尚未設定，請聯絡系統管理員'
            : err.message.startsWith('Too many')
              ? '嘗試次數過多，請 15 分鐘後再試'
              : '帳號或密碼錯誤'
          : '登入失敗，請檢查網路後再試',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page page-narrow">
      <h1>報到系統登入</h1>
      {expired && <p className="error">登入已過期，請重新登入。</p>}
      <form onSubmit={handleSubmit} className="form">
        <label>
          帳號
          <input required autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          密碼
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label>
          你的名字
          <input required maxLength={30} value={staffName} onChange={(e) => setStaffName(e.target.value)} />
        </label>
        <p className="hint">名字會記錄在你經手的每一筆報到上，方便事後查詢。</p>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? '登入中…' : '登入'}
        </button>
      </form>
    </div>
  );
}
