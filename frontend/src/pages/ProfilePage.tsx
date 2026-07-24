import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { TEAM_OPTIONS } from '../constants';

const CHINESE_NAME_REGEX = /^[一-鿿]+$/;

export function ProfilePage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [name, setName] = useState('');
  const [team, setTeam] = useState('');
  const [lineId, setLineId] = useState('');
  const [phone, setPhone] = useState('');
  const [mode, setMode] = useState<'view' | 'edit'>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    api
      .getProfile(token)
      .then((profile) => {
        const isComplete = !!(
          profile.name &&
          profile.team &&
          profile.lineId &&
          profile.phone
        );
        setName(profile.name ?? '');
        setTeam(profile.team ?? '');
        setLineId(profile.lineId ?? '');
        setPhone(profile.phone ?? '');
        // A profile that's already complete opens in view mode; an
        // incomplete one (including the forced redirect from ticket
        // registration) opens straight into the edit form.
        setMode(isComplete && !from ? 'view' : 'edit');
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '載入個人資料失敗，請重新整理再試一次');
        setLoading(false);
      });
  }, [token, navigate, from]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !team || !lineId.trim() || !phone.trim()) {
      setError('請完整填寫所有欄位');
      return;
    }

    if (!CHINESE_NAME_REGEX.test(name.trim())) {
      setError('姓名必須為中文全名，請勿包含英文、數字或符號');
      return;
    }

    setSaving(true);
    try {
      await api.updateProfile(token!, {
        name: name.trim(),
        team,
        lineId: lineId.trim(),
        phone: phone.trim(),
      });
      if (from) {
        navigate(from);
      } else {
        setMode('view');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗，請稍後再試');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page">載入中…</div>;

  if (mode === 'view') {
    return (
      <div className="page page-narrow">
        <h1>個人資料設定</h1>
        <p className="hint">已儲存</p>
        <div className="profile-summary">
          <p>
            <strong>姓名</strong>：{name}
          </p>
          <p>
            <strong>所屬系統/團隊</strong>：{team}
          </p>
          <p>
            <strong>LINE ID</strong>：{lineId}
          </p>
          <p>
            <strong>聯絡電話</strong>：{phone}
          </p>
        </div>
        <div className="button-row">
          <button onClick={() => setMode('edit')}>編輯</button>
          <button className="link-button" onClick={() => navigate('/events')}>
            回到主頁
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page page-narrow">
      <h1>個人資料設定</h1>
      {from && <p className="hint">請先完成個人資料才能繼續購票</p>}
      <form onSubmit={handleSubmit} className="form">
        <label>
          姓名
          <p className="hint">請務必填寫本名（中文全名）</p>
          <input
            required
            pattern="[一-鿿]+"
            title="姓名必須為中文全名，請勿包含英文、數字或符號"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          所屬系統/團隊
          <select
            required
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            <option value="">請選擇</option>
            {TEAM_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label>
          LINE ID
          <input
            required
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
          />
        </label>
        <label>
          聯絡電話
          <input
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={saving}>
          {saving ? '儲存中…' : '儲存'}
        </button>
      </form>
    </div>
  );
}
