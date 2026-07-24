import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Companion, GroupMember, RegistrationInfo, TicketType } from '../api/types';
import { TEAM_OPTIONS } from '../constants';

const COMPANION_RELATIONSHIPS = ['父母', '兄弟姊妹', '伴侶', '子女'] as const;

/** No English letters, digits, or symbols — Chinese characters only. */
const CHINESE_NAME_REGEX = /^[一-鿿]+$/;

/** Shown on each family-member ticket when the buyer is buying entirely on behalf of others. */
const FAMILY_PURCHASE_NOTE_LABEL =
  '務必於此欄填寫夥伴資訊，以利行政組方便查核親屬身份';

/** Shown on companion tickets #2+ in the ordinary (buyer + companions) flow. */
const COMPANION_NOTE_LABEL =
  '如為幫親友及子女代購請註明夥伴身份及所屬體系與相關聯絡方式';

interface MemberDraft {
  name: string;
  contact: string;
  mealChoice: string;
  mealCustom: string;
}

function emptyMemberDraft(): MemberDraft {
  return { name: '', contact: '', mealChoice: '', mealCustom: '' };
}

function isMemberIncomplete(member: MemberDraft): boolean {
  if (!member.name.trim() || !member.contact.trim()) return true;
  if (!member.mealChoice) return true;
  if (member.mealChoice === '其他' && !member.mealCustom.trim()) return true;
  return false;
}

interface CompanionDraft {
  name: string;
  relationship: string;
  mealChoice: string;
  mealCustom: string;
  note: string;
}

function emptyCompanionDraft(): CompanionDraft {
  return {
    name: '',
    relationship: '',
    mealChoice: '',
    mealCustom: '',
    note: '',
  };
}

function companionError(companion: CompanionDraft): string | null {
  if (!companion.name.trim()) return '請填寫姓名';
  if (!CHINESE_NAME_REGEX.test(companion.name.trim())) return '姓名僅能填寫中文字';
  if (!companion.relationship) return '請選擇與訂購人關係';
  if (!companion.mealChoice) return '請填寫用餐需求';
  if (companion.mealChoice === '其他' && !companion.mealCustom.trim()) return '請說明用餐需求';
  if (!companion.note.trim()) return '請填寫備註欄位';
  return null;
}

/** buyingForFamily: every ticket (including #1) needs a companion entry. Otherwise: quantity - 1. */
function neededCompanionCount(buyingForFamily: boolean, quantity: number): number {
  return buyingForFamily ? quantity : quantity - 1;
}

function resizeCompanions(
  buyingForFamily: boolean,
  quantity: number,
  prev: CompanionDraft[],
): CompanionDraft[] {
  const needed = neededCompanionCount(buyingForFamily, quantity);
  if (needed <= prev.length) return prev.slice(0, needed);
  return [
    ...prev,
    ...Array.from({ length: needed - prev.length }, () => emptyCompanionDraft()),
  ];
}

export function RegistrationPage() {
  const { ticketTypeId } = useParams<{ ticketTypeId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const passcode = (location.state as { passcode?: string } | null)?.passcode;

  const [ticketType, setTicketType] = useState<TicketType | null>(null);
  const [registrantName, setRegistrantName] = useState('');
  const [registrantTeam, setRegistrantTeam] = useState('');
  const [registrantLineId, setRegistrantLineId] = useState('');
  const [registrantPhone, setRegistrantPhone] = useState('');
  const [mealChoice, setMealChoice] = useState('');
  const [mealCustom, setMealCustom] = useState('');
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [companions, setCompanions] = useState<CompanionDraft[]>([]);
  const [buyingForFamily, setBuyingForFamily] = useState(false);
  const [childSeatCount, setChildSeatCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!ticketTypeId) return;

    api
      .getProfile(token)
      .then((profile) => {
        if (!profile.name || !profile.team || !profile.lineId || !profile.phone) {
          navigate('/profile', { state: { from: `/register/${ticketTypeId}` } });
          return;
        }
        setRegistrantName(profile.name);
        setRegistrantTeam(profile.team);
        setRegistrantLineId(profile.lineId);
        setRegistrantPhone(profile.phone);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入個人資料失敗，請重新整理再試一次'),
      );

    api
      .getTicketType(ticketTypeId)
      .then((tt) => {
        setTicketType(tt);
        if (tt.fixedQuantity) {
          // The leader occupies one of the fixedQuantity seats themselves.
          setMembers(
            Array.from({ length: tt.fixedQuantity - 1 }, () => emptyMemberDraft()),
          );
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入票種資料失敗，請重新整理再試一次'),
      );
  }, [ticketTypeId, token, navigate]);

  function updateMember(index: number, patch: Partial<MemberDraft>) {
    setMembers((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function updateCompanion(index: number, patch: Partial<CompanionDraft>) {
    setCompanions((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  function handleQuantityChange(nextQuantity: number) {
    setQuantity(nextQuantity);
    setCompanions((prev) => resizeCompanions(buyingForFamily, nextQuantity, prev));
  }

  function handleBuyingForFamilyChange(checked: boolean) {
    setBuyingForFamily(checked);
    setCompanions((prev) => resizeCompanions(checked, quantity, prev));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const isGroup = !!ticketType?.fixedQuantity;
    const allowsMultiBuy = !isGroup && (ticketType?.maxQuantityPerOrder ?? 1) > 1;
    const isFamilyPurchase = allowsMultiBuy && buyingForFamily;

    if (!registrantName.trim() || !registrantTeam || !registrantLineId.trim() || !registrantPhone.trim()) {
      setError('請完整填寫報名人基本資料');
      return;
    }
    if (!isFamilyPurchase && (!mealChoice || (mealChoice === '其他' && !mealCustom.trim()))) {
      setError('請填寫用餐需求');
      return;
    }

    if (isGroup) {
      if (members.some(isMemberIncomplete)) {
        const proceed = window.confirm(
          '我敬愛的領導人，敬請於第二波次開放售票前將其餘名10位組員的名單上傳到系統上，如未上傳可能所有套票會自動釋出給第二波次的用戶搶購。',
        );
        if (!proceed) return;
      }
    }

    if (allowsMultiBuy) {
      if (!isFamilyPurchase && !CHINESE_NAME_REGEX.test(registrantName.trim())) {
        setError('姓名僅能填寫中文字');
        return;
      }
      const needed = neededCompanionCount(buyingForFamily, quantity);
      if (needed > 0) {
        const firstError = companions.map(companionError).find((msg) => msg !== null);
        if (firstError) {
          setError(firstError);
          return;
        }
      }
    }

    const groupMembers: GroupMember[] = members.map((m) => ({
      name: m.name.trim(),
      contact: m.contact.trim(),
      mealPreference: m.mealChoice === '其他' ? m.mealCustom.trim() : m.mealChoice,
    }));

    const companionPayload: Companion[] = companions.map((c) => ({
      name: c.name.trim(),
      relationship: c.relationship,
      mealPreference: c.mealChoice === '其他' ? c.mealCustom.trim() : c.mealChoice,
      note: c.note.trim(),
    }));

    const registration: RegistrationInfo = {
      registrantName: registrantName.trim(),
      registrantTeam,
      registrantLineId: registrantLineId.trim(),
      registrantPhone: registrantPhone.trim(),
      mealPreference: isFamilyPurchase
        ? '（代訂親友，詳見備註）'
        : mealChoice === '其他'
          ? mealCustom.trim()
          : mealChoice,
      ...(isGroup && {
        // The account holder filling out this form is always the group
        // leader — no point asking for the same name/LINE/phone twice.
        groupLeaderName: registrantName.trim(),
        groupLeaderLineId: registrantLineId.trim(),
        groupLeaderPhone: registrantPhone.trim(),
        groupMembers,
      }),
      ...(allowsMultiBuy &&
        neededCompanionCount(buyingForFamily, quantity) > 0 && {
          companions: companionPayload,
        }),
      ...(isFamilyPurchase && { buyingForFamily: true }),
      ...(allowsMultiBuy && childSeatCount > 0 && { childSeatCount }),
    };

    navigate(`/queue/${ticketTypeId}`, {
      state: {
        registration,
        quantity: allowsMultiBuy ? quantity : undefined,
        passcode,
      },
    });
  }

  if (!ticketType) {
    return (
      <div className="page">
        {error ? <p className="error">{error}</p> : '載入中…'}
      </div>
    );
  }

  const isGroup = !!ticketType.fixedQuantity;
  const allowsMultiBuy = !isGroup && (ticketType.maxQuantityPerOrder ?? 1) > 1;
  const isFamilyPurchase = allowsMultiBuy && buyingForFamily;
  const showCompanionBlocks = allowsMultiBuy && neededCompanionCount(buyingForFamily, quantity) > 0;

  return (
    <div className="page page-narrow">
      <h1>報名資料</h1>
      <p className="hint">
        {ticketType.name}
        {ticketType.batch && ` · ${ticketType.batch.name}`}
        {' · NT$ '}
        {ticketType.price.toLocaleString()}
      </p>
      <form onSubmit={handleSubmit} className="form">
        {allowsMultiBuy && (
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={buyingForFamily}
              onChange={(e) => handleBuyingForFamilyChange(e.target.checked)}
            />
            自己已是團體票成員（以下為幫親友代訂）
          </label>
        )}

        {!isFamilyPurchase && (
          <>
            <label>
              姓名{allowsMultiBuy ? '（僅限中文）' : ''}
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
            <label>
              用餐需求
              <select
                value={mealChoice}
                onChange={(e) => setMealChoice(e.target.value)}
              >
                <option value="">請選擇</option>
                <option value="葷食">葷食</option>
                <option value="素食">素食</option>
                <option value="其他">其他</option>
              </select>
            </label>
            {mealChoice === '其他' && (
              <label>
                請說明用餐需求
                <input
                  value={mealCustom}
                  onChange={(e) => setMealCustom(e.target.value)}
                />
              </label>
            )}
          </>
        )}

        {isGroup && (
          <>
            <h2>團體票資料</h2>
            <p className="hint">限「首席」購買，每位首席僅限購 1 組。</p>
            <p className="hint">主揪者資訊即為上方填寫的個人資料，無需重複填寫</p>

            <h3>其餘團體成員名單（共 {members.length} 位）</h3>
            {members.map((member, index) => (
              <div key={index} className="group-member-block">
                <h4>第 {index + 1} 位成員</h4>
                <label>
                  姓名
                  <input
                    value={member.name}
                    onChange={(e) => updateMember(index, { name: e.target.value })}
                  />
                </label>
                <label>
                  聯絡方式（LINE ID 或電話）
                  <input
                    value={member.contact}
                    onChange={(e) =>
                      updateMember(index, { contact: e.target.value })
                    }
                  />
                </label>
                <label>
                  用餐需求
                  <select
                    value={member.mealChoice}
                    onChange={(e) =>
                      updateMember(index, { mealChoice: e.target.value })
                    }
                  >
                    <option value="">請選擇</option>
                    <option value="葷食">葷食</option>
                    <option value="素食">素食</option>
                    <option value="其他">其他</option>
                  </select>
                </label>
                {member.mealChoice === '其他' && (
                  <label>
                    請說明用餐需求
                    <input
                      value={member.mealCustom}
                      onChange={(e) =>
                        updateMember(index, { mealCustom: e.target.value })
                      }
                    />
                  </label>
                )}
              </div>
            ))}
          </>
        )}

        {allowsMultiBuy && (
          <>
            <h2>張數</h2>
            <p className="hint">
              可代替家人一同購買{ticketType.sharedStockKey ? '此早鳥票' : '此票卷'}，最多{' '}
              {ticketType.maxQuantityPerOrder} 張
            </p>
            <label>
              購買張數
              <select
                value={quantity}
                onChange={(e) => handleQuantityChange(Number(e.target.value))}
              >
                {Array.from(
                  { length: ticketType.maxQuantityPerOrder ?? 1 },
                  (_, i) => i + 1,
                ).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            {showCompanionBlocks && (
              <>
                {!isFamilyPurchase && (
                  <p className="hint">第 1 張即為上方填寫的個人資料，無需重複填寫</p>
                )}
                <p className="hint">孩童身形與用餐習慣請家長自行評估</p>
                {companions.map((companion, index) => (
                  <div key={index} className="group-member-block">
                    <h4>第 {index + (isFamilyPurchase ? 1 : 2)} 張</h4>
                    <label>
                      姓名（僅限中文）
                      <input
                        value={companion.name}
                        onChange={(e) =>
                          updateCompanion(index, { name: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      與訂購人關係
                      <select
                        value={companion.relationship}
                        onChange={(e) =>
                          updateCompanion(index, { relationship: e.target.value })
                        }
                      >
                        <option value="">請選擇</option>
                        {COMPANION_RELATIONSHIPS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      用餐需求
                      <select
                        value={companion.mealChoice}
                        onChange={(e) =>
                          updateCompanion(index, { mealChoice: e.target.value })
                        }
                      >
                        <option value="">請選擇</option>
                        <option value="葷食">葷食</option>
                        <option value="素食">素食</option>
                        <option value="其他">其他</option>
                      </select>
                    </label>
                    {companion.mealChoice === '其他' && (
                      <label>
                        請說明用餐需求
                        <input
                          value={companion.mealCustom}
                          onChange={(e) =>
                            updateCompanion(index, { mealCustom: e.target.value })
                          }
                        />
                      </label>
                    )}
                    <label>
                      {isFamilyPurchase ? FAMILY_PURCHASE_NOTE_LABEL : COMPANION_NOTE_LABEL}
                      <input
                        value={companion.note}
                        onChange={(e) =>
                          updateCompanion(index, { note: e.target.value })
                        }
                      />
                    </label>
                  </div>
                ))}
              </>
            )}

            <label>
              兒童座椅需求（僅調查用，不另外收費）
              <select
                value={childSeatCount}
                onChange={(e) => setChildSeatCount(Number(e.target.value))}
              >
                <option value={0}>無需求</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} 張
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}
        <button type="submit">下一步：進入排隊室</button>
      </form>
    </div>
  );
}
