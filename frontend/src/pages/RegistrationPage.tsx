import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { RegistrationInfo, TicketType } from '../api/types';

// TODO(Austin): 替換成真實的系統/團隊清單
const TEAM_OPTIONS = ['示範選項一', '示範選項二', '示範選項三', '其他'];

export function RegistrationPage() {
  const { ticketTypeId } = useParams<{ ticketTypeId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();

  const [ticketType, setTicketType] = useState<TicketType | null>(null);
  const [registrantName, setRegistrantName] = useState('');
  const [registrantTeam, setRegistrantTeam] = useState('');
  const [registrantLineId, setRegistrantLineId] = useState('');
  const [registrantPhone, setRegistrantPhone] = useState('');
  const [groupLeaderName, setGroupLeaderName] = useState('');
  const [groupLeaderLineId, setGroupLeaderLineId] = useState('');
  const [groupLeaderPhone, setGroupLeaderPhone] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!ticketTypeId) return;
    api.getTicketType(ticketTypeId).then((tt) => {
      setTicketType(tt);
      if (tt.fixedQuantity) {
        setGroupMembers(Array(tt.fixedQuantity).fill(''));
      }
    });
  }, [ticketTypeId, token, navigate]);

  function updateMember(index: number, value: string) {
    setGroupMembers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!registrantName.trim() || !registrantTeam || !registrantLineId.trim() || !registrantPhone.trim()) {
      setError('請完整填寫報名人基本資料');
      return;
    }

    const isGroup = !!ticketType?.fixedQuantity;
    if (isGroup) {
      if (!groupLeaderName.trim() || !groupLeaderLineId.trim() || !groupLeaderPhone.trim()) {
        setError('請完整填寫主揪者資料');
        return;
      }
      if (groupMembers.some((name) => !name.trim())) {
        setError('請填寫所有團體成員的姓名');
        return;
      }
    }

    const registration: RegistrationInfo = {
      registrantName: registrantName.trim(),
      registrantTeam,
      registrantLineId: registrantLineId.trim(),
      registrantPhone: registrantPhone.trim(),
      ...(isGroup && {
        groupLeaderName: groupLeaderName.trim(),
        groupLeaderLineId: groupLeaderLineId.trim(),
        groupLeaderPhone: groupLeaderPhone.trim(),
        groupMembers: groupMembers.map((name) => name.trim()),
      }),
    };

    navigate(`/queue/${ticketTypeId}`, { state: { registration } });
  }

  if (!ticketType) return <div className="page">載入中…</div>;

  const isGroup = !!ticketType.fixedQuantity;

  return (
    <div className="page page-narrow">
      <h1>報名資料</h1>
      <p className="hint">{ticketType.name}</p>
      <form onSubmit={handleSubmit} className="form">
        <label>
          姓名
          <input
            value={registrantName}
            onChange={(e) => setRegistrantName(e.target.value)}
          />
        </label>
        <label>
          所屬系統/團隊
          <select
            value={registrantTeam}
            onChange={(e) => setRegistrantTeam(e.target.value)}
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
            value={registrantLineId}
            onChange={(e) => setRegistrantLineId(e.target.value)}
          />
        </label>
        <label>
          聯絡電話
          <input
            value={registrantPhone}
            onChange={(e) => setRegistrantPhone(e.target.value)}
          />
        </label>

        {isGroup && (
          <>
            <h2>團體票資料</h2>
            <label>
              主揪者姓名
              <input
                value={groupLeaderName}
                onChange={(e) => setGroupLeaderName(e.target.value)}
              />
            </label>
            <label>
              主揪 LINE ID
              <input
                value={groupLeaderLineId}
                onChange={(e) => setGroupLeaderLineId(e.target.value)}
              />
            </label>
            <label>
              主揪聯絡電話
              <input
                value={groupLeaderPhone}
                onChange={(e) => setGroupLeaderPhone(e.target.value)}
              />
            </label>

            <h3>團體成員名單（共 {ticketType.fixedQuantity} 位）</h3>
            {groupMembers.map((name, index) => (
              <label key={index}>
                第 {index + 1} 位成員姓名
                <input
                  value={name}
                  onChange={(e) => updateMember(index, e.target.value)}
                />
              </label>
            ))}
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit">下一步：進入排隊室</button>
      </form>
    </div>
  );
}
