import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type {
  Companion,
  GroupMember,
  IncomingTransfer,
  OrderWithSession,
} from '../api/types';

const BUYER_TYPE_OPTIONS = ['夥伴', '親友'] as const;
type BuyerType = (typeof BUYER_TYPE_OPTIONS)[number];

const REFUND_CUTOFF_DAYS = 7;
const CANCELLABLE_STATUSES = ['PENDING', 'PAID'];
const MEAL_OPTIONS = ['葷食', '素食'];
const COMPANION_RELATIONSHIPS = ['父母', '兄弟姊妹', '伴侶', '子女'] as const;

/** Shown to both sides of a transfer while the early-bird batch is being reconciled by hand. */
const TRANSFER_ADMIN_NOTICE =
  '因早鳥波次搶票已結束，行政組進入訂單彙整階段，請有轉讓票卷者務必告知行政組夥伴，避免訂單轉讓不被承認，導致接收者的票卷不被承認，感謝配合。';

interface MemberDraft {
  name: string;
  contact: string;
  mealChoice: string;
  mealCustom: string;
}

/**
 * Orders placed before this feature only stored a plain member-name string.
 * Tolerate that legacy shape here instead of crashing on `.name`/`.trim()`
 * of a string primitive when displaying/editing an older order.
 */
function toMemberDraft(member?: GroupMember | string): MemberDraft {
  if (!member) return { name: '', contact: '', mealChoice: '', mealCustom: '' };
  if (typeof member === 'string') {
    return { name: member, contact: '', mealChoice: '', mealCustom: '' };
  }
  const isKnownChoice = MEAL_OPTIONS.includes(member.mealPreference);
  return {
    name: member.name,
    contact: member.contact,
    mealChoice: !member.mealPreference
      ? ''
      : isKnownChoice
        ? member.mealPreference
        : '其他',
    mealCustom: isKnownChoice ? '' : member.mealPreference,
  };
}

/** True for a member entry (old string or new object) with a non-blank name. */
function memberHasName(member: GroupMember | string): boolean {
  return typeof member === 'string' ? !!member.trim() : !!member.name.trim();
}

function toGroupMember(draft: MemberDraft): GroupMember {
  return {
    name: draft.name.trim(),
    contact: draft.contact.trim(),
    mealPreference:
      draft.mealChoice === '其他' ? draft.mealCustom.trim() : draft.mealChoice,
  };
}

interface RegistrantDraft {
  name: string;
  team: string;
  lineId: string;
  phone: string;
  mealChoice: string;
  mealCustom: string;
}

interface CompanionDraft {
  name: string;
  relationship: string;
  mealChoice: string;
  mealCustom: string;
  note: string;
}

function toRegistrantDraft(order: OrderWithSession): RegistrantDraft {
  const isKnownChoice = MEAL_OPTIONS.includes(order.mealPreference);
  return {
    name: order.registrantName,
    team: order.registrantTeam,
    lineId: order.registrantLineId,
    phone: order.registrantPhone,
    mealChoice: isKnownChoice ? order.mealPreference : '其他',
    mealCustom: isKnownChoice ? '' : order.mealPreference,
  };
}

function toCompanionDraft(companion?: Companion): CompanionDraft {
  if (!companion) {
    return {
      name: '',
      relationship: '',
      mealChoice: '',
      mealCustom: '',
      note: '',
    };
  }
  const isKnownChoice = MEAL_OPTIONS.includes(companion.mealPreference);
  return {
    name: companion.name,
    relationship: companion.relationship,
    mealChoice: isKnownChoice ? companion.mealPreference : '其他',
    mealCustom: isKnownChoice ? '' : companion.mealPreference,
    note: companion.note,
  };
}

function toCompanion(draft: CompanionDraft): Companion {
  return {
    name: draft.name.trim(),
    relationship: draft.relationship,
    mealPreference:
      draft.mealChoice === '其他' ? draft.mealCustom.trim() : draft.mealChoice,
    note: draft.note.trim(),
  };
}

function refundDeadline(order: OrderWithSession): Date {
  const deadline = new Date(order.ticketType.session.startTime);
  deadline.setDate(deadline.getDate() - REFUND_CUTOFF_DAYS);
  return deadline;
}

/** True once the ticket's own wave has closed (SaleBatch.saleEndAt) — refunds and member-list edits stop regardless of the event-date cutoff. */
function batchClosed(order: OrderWithSession): boolean {
  const saleEndAt = order.ticketType.batch?.saleEndAt;
  return !!saleEndAt && Date.now() >= new Date(saleEndAt).getTime();
}

/** Registrant/companion info on a non-group order has no batch-close cutoff — only the event itself having already happened stops edits. */
function eventAlreadyHappened(order: OrderWithSession): boolean {
  return Date.now() > new Date(order.ticketType.session.startTime).getTime();
}

function canCancel(order: OrderWithSession): boolean {
  return (
    CANCELLABLE_STATUSES.includes(order.status) &&
    Date.now() <= refundDeadline(order).getTime() &&
    !batchClosed(order)
  );
}

export function MyTicketsPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderWithSession[] | null>(null);
  const [incomingTransfers, setIncomingTransfers] = useState<
    IncomingTransfer[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memberDrafts, setMemberDrafts] = useState<
    Record<string, MemberDraft[]>
  >({});
  const [childSeatDrafts, setChildSeatDrafts] = useState<
    Record<string, number>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [transferringId, setTransferringId] = useState<string | null>(null);
  const [transferEmail, setTransferEmail] = useState('');
  const [transferBusyId, setTransferBusyId] = useState<string | null>(null);
  const [respondingTransferId, setRespondingTransferId] = useState<
    string | null
  >(null);
  const [myName, setMyName] = useState('');
  const [reviewingTransferId, setReviewingTransferId] = useState<string | null>(
    null,
  );
  const [reviewFromName, setReviewFromName] = useState('');
  const [reviewToName, setReviewToName] = useState('');
  const [reviewMeal, setReviewMeal] = useState('');
  const [reviewBuyerType, setReviewBuyerType] = useState<BuyerType | ''>('');
  const [registrantDrafts, setRegistrantDrafts] = useState<
    Record<string, RegistrantDraft>
  >({});
  const [companionDrafts, setCompanionDrafts] = useState<
    Record<string, CompanionDraft[]>
  >({});

  function reloadOrders() {
    if (!token) return;
    api
      .listMyOrders(token)
      .then(setOrders)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入失敗'),
      );
  }

  function reloadIncomingTransfers() {
    if (!token) return;
    api
      .listIncomingTransfers(token)
      .then(setIncomingTransfers)
      .catch(() => {});
  }

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    reloadOrders();
    reloadIncomingTransfers();
    api
      .getProfile(token)
      .then((profile) => setMyName(profile.name ?? ''))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, navigate]);

  // Pops the review-and-confirm window automatically whenever there's a
  // pending incoming transfer and none is currently being reviewed — the
  // recipient shouldn't have to know to go click "接受" to discover it.
  useEffect(() => {
    if (reviewingTransferId || incomingTransfers.length === 0) return;
    startReviewAccept(incomingTransfers[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingTransfers, reviewingTransferId]);

  async function handleCancel(order: OrderWithSession) {
    if (!token) return;
    if (!window.confirm('確定要退這張票嗎？此操作無法復原。')) return;
    setCancellingId(order.id);
    setError(null);
    try {
      const updated = await api.cancelOrder(token, order.id);
      setOrders(
        (prev) =>
          prev?.map((o) => (o.id === order.id ? { ...o, ...updated } : o)) ??
          null,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '退票失敗');
    } finally {
      setCancellingId(null);
    }
  }

  function requiredMemberCount(order: OrderWithSession): number {
    return (order.ticketType.fixedQuantity ?? 1) - 1;
  }

  function startEditingMembers(order: OrderWithSession) {
    setEditingId(order.id);
    const count = requiredMemberCount(order);
    const existing = order.groupMembers ?? [];
    setMemberDrafts((prev) => ({
      ...prev,
      [order.id]: Array.from({ length: count }, (_, i) =>
        toMemberDraft(existing[i]),
      ),
    }));
    setChildSeatDrafts((prev) => ({
      ...prev,
      [order.id]: order.childSeatCount,
    }));
  }

  function updateMemberDraft(
    orderId: string,
    index: number,
    patch: Partial<MemberDraft>,
  ) {
    setMemberDrafts((prev) => {
      const next = [...(prev[orderId] ?? [])];
      next[index] = { ...next[index], ...patch };
      return { ...prev, [orderId]: next };
    });
  }

  async function handleSaveMembers(order: OrderWithSession) {
    if (!token) return;
    const draft = memberDrafts[order.id] ?? [];
    setSavingId(order.id);
    setError(null);
    try {
      const updated = await api.updateGroupMembers(
        token,
        order.id,
        draft.map(toGroupMember),
        childSeatDrafts[order.id] ?? 0,
      );
      setOrders(
        (prev) =>
          prev?.map((o) => (o.id === order.id ? { ...o, ...updated } : o)) ??
          null,
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSavingId(null);
    }
  }

  /** Non-group orders (plain individual or multi-quantity family/companion tickets) edit their own registrant + companion info here instead of a member list. */
  function startEditingRegistrant(order: OrderWithSession) {
    setEditingId(order.id);
    setRegistrantDrafts((prev) => ({
      ...prev,
      [order.id]: toRegistrantDraft(order),
    }));
    setCompanionDrafts((prev) => ({
      ...prev,
      [order.id]: (order.companions ?? []).map(toCompanionDraft),
    }));
  }

  function updateRegistrantDraft(
    orderId: string,
    patch: Partial<RegistrantDraft>,
  ) {
    setRegistrantDrafts((prev) => ({
      ...prev,
      [orderId]: { ...prev[orderId], ...patch },
    }));
  }

  function updateCompanionDraft(
    orderId: string,
    index: number,
    patch: Partial<CompanionDraft>,
  ) {
    setCompanionDrafts((prev) => {
      const next = [...(prev[orderId] ?? [])];
      next[index] = { ...next[index], ...patch };
      return { ...prev, [orderId]: next };
    });
  }

  async function handleSaveRegistrantInfo(order: OrderWithSession) {
    if (!token) return;
    const draft = registrantDrafts[order.id];
    if (!draft) return;
    setSavingId(order.id);
    setError(null);
    try {
      const companions = order.companions
        ? (companionDrafts[order.id] ?? []).map(toCompanion)
        : undefined;
      const updated = await api.updateRegistrantInfo(token, order.id, {
        registrantName: draft.name.trim(),
        registrantTeam: draft.team.trim(),
        registrantLineId: draft.lineId.trim(),
        registrantPhone: draft.phone.trim(),
        mealPreference:
          draft.mealChoice === '其他'
            ? draft.mealCustom.trim()
            : draft.mealChoice,
        companions,
      });
      setOrders(
        (prev) =>
          prev?.map((o) => (o.id === order.id ? { ...o, ...updated } : o)) ??
          null,
      );
      setEditingId(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '儲存失敗');
    } finally {
      setSavingId(null);
    }
  }

  function startTransfer(orderId: string) {
    setTransferringId(orderId);
    setTransferEmail('');
  }

  async function handleSubmitTransfer(orderId: string) {
    if (!token) return;
    const toEmail = transferEmail.trim();
    if (!toEmail) return;
    setTransferBusyId(orderId);
    setError(null);
    try {
      await api.transferOrder(token, orderId, toEmail);
      setTransferringId(null);
      reloadOrders();
      window.alert(TRANSFER_ADMIN_NOTICE);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '轉讓邀請送出失敗');
    } finally {
      setTransferBusyId(null);
    }
  }

  async function handleCancelTransfer(transferId: string, orderId: string) {
    if (!token) return;
    setTransferBusyId(orderId);
    setError(null);
    try {
      await api.cancelTransfer(token, transferId);
      reloadOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '取消轉讓失敗');
    } finally {
      setTransferBusyId(null);
    }
  }

  /** Expands the review form inline on this card instead of accepting immediately — the recipient checks/edits what goes into the admin reconciliation notice before it's locked in. */
  function startReviewAccept(transfer: IncomingTransfer) {
    setReviewingTransferId(transfer.id);
    setReviewFromName(transfer.fromUser.name ?? '');
    setReviewToName(myName);
    setReviewMeal(transfer.order.mealPreference);
    setReviewBuyerType('');
    setError(null);
  }

  function cancelReviewAccept() {
    setReviewingTransferId(null);
  }

  async function handleConfirmAccept(transferId: string) {
    if (!token) return;
    if (!reviewFromName.trim() || !reviewToName.trim() || !reviewMeal.trim()) {
      setError('請完整填寫轉讓者姓名、受讓者姓名與用餐需求');
      return;
    }
    if (!reviewBuyerType) {
      setError('請選擇夥伴／親友');
      return;
    }
    setRespondingTransferId(transferId);
    setError(null);
    try {
      await api.acceptTransfer(token, transferId, {
        fromName: reviewFromName.trim(),
        toName: reviewToName.trim(),
        mealPreference: reviewMeal.trim(),
        buyingForFamily: reviewBuyerType === '親友',
      });
      setReviewingTransferId(null);
      reloadIncomingTransfers();
      reloadOrders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '接受轉讓失敗');
    } finally {
      setRespondingTransferId(null);
    }
  }

  async function handleRejectIncoming(transferId: string) {
    if (!token) return;
    setRespondingTransferId(transferId);
    setError(null);
    try {
      await api.rejectTransfer(token, transferId);
      setReviewingTransferId(null);
      reloadIncomingTransfers();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '拒絕轉讓失敗');
    } finally {
      setRespondingTransferId(null);
    }
  }

  if (!orders) return <div className="page">載入中…</div>;

  return (
    <div className="page">
      <h1>我的票卷</h1>
      {error && <p className="error">{error}</p>}
      {incomingTransfers.length > 0 && (
        <div className="my-ticket-list">
          {incomingTransfers.map((transfer) => (
            <div key={transfer.id} className="my-ticket-card">
              <h2>收到轉讓邀請：{transfer.order.ticketType.name}</h2>
              <p className="hint">
                {transfer.fromUser.email} 想將這張票轉讓給您
              </p>
            </div>
          ))}
        </div>
      )}
      {orders.length === 0 && <p>目前沒有任何訂單</p>}
      <div className="my-ticket-list">
        {orders.map((order) => (
          <div key={order.id} className="my-ticket-card">
            <h2>{order.ticketType.name}</h2>
            <p className="hint">
              {order.ticketType.session.venue} ·{' '}
              {new Date(order.ticketType.session.startTime).toLocaleString()}
            </p>
            <p>
              張數：{order.quantity} · 總金額：NT${' '}
              {order.totalAmount.toLocaleString()}
            </p>
            <p>
              狀態：<span className="badge">{order.status}</span>
            </p>
            {order.companions && order.companions.length > 0 && (
              <p className="hint">
                {order.buyingForFamily ? '代訂親友' : '同行親友'}：
                {order.companions
                  .map(
                    (c, i) =>
                      `第${i + (order.buyingForFamily ? 1 : 2)}張 ${c.name || '（未填寫）'}（${c.relationship}）／備註：${c.note}`,
                  )
                  .join('、')}
              </p>
            )}
            {order.childSeatCount > 0 && (
              <p className="hint">兒童座椅需求：{order.childSeatCount} 張</p>
            )}
            {order.ticketType.fixedQuantity && (
              <div className="group-members-editor">
                {editingId === order.id ? (
                  <>
                    <h3>
                      其餘團體成員名單（共 {requiredMemberCount(order)} 位）
                    </h3>
                    {(memberDrafts[order.id] ?? []).map((member, index) => (
                      <div key={index} className="group-member-block">
                        <h4>第 {index + 1} 位成員</h4>
                        <label>
                          姓名
                          <input
                            value={member.name}
                            onChange={(e) =>
                              updateMemberDraft(order.id, index, {
                                name: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          聯絡方式（LINE ID 或電話）
                          <input
                            value={member.contact}
                            onChange={(e) =>
                              updateMemberDraft(order.id, index, {
                                contact: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          用餐需求
                          <select
                            value={member.mealChoice}
                            onChange={(e) =>
                              updateMemberDraft(order.id, index, {
                                mealChoice: e.target.value,
                              })
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
                                updateMemberDraft(order.id, index, {
                                  mealCustom: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                      </div>
                    ))}
                    <label>
                      兒童座椅總張數需求
                      <select
                        value={childSeatDrafts[order.id] ?? 0}
                        onChange={(e) =>
                          setChildSeatDrafts((prev) => ({
                            ...prev,
                            [order.id]: Number(e.target.value),
                          }))
                        }
                      >
                        <option value={0}>無需求</option>
                        {Array.from({ length: 15 }, (_, i) => i + 1).map(
                          (n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                    <div className="button-row">
                      <button
                        disabled={savingId === order.id}
                        onClick={() => handleSaveMembers(order)}
                      >
                        {savingId === order.id ? '儲存中…' : '儲存名單'}
                      </button>
                      <button
                        className="link-button"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="hint">
                      {(order.groupMembers ?? []).filter(memberHasName).length}{' '}
                      / {requiredMemberCount(order)} 位其餘成員已填寫
                    </p>
                    {batchClosed(order) ? (
                      <p className="hint">此波次已截止，無法再編輯成員名單</p>
                    ) : (
                      <button onClick={() => startEditingMembers(order)}>
                        編輯成員名單
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
            {!order.ticketType.fixedQuantity && (
              <div className="group-members-editor">
                {editingId === order.id ? (
                  <>
                    <h3>編輯報名資料</h3>
                    <label>
                      姓名
                      <input
                        value={registrantDrafts[order.id]?.name ?? ''}
                        onChange={(e) =>
                          updateRegistrantDraft(order.id, {
                            name: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      所屬系隊
                      <input
                        value={registrantDrafts[order.id]?.team ?? ''}
                        onChange={(e) =>
                          updateRegistrantDraft(order.id, {
                            team: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      LINE ID
                      <input
                        value={registrantDrafts[order.id]?.lineId ?? ''}
                        onChange={(e) =>
                          updateRegistrantDraft(order.id, {
                            lineId: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      聯絡電話
                      <input
                        value={registrantDrafts[order.id]?.phone ?? ''}
                        onChange={(e) =>
                          updateRegistrantDraft(order.id, {
                            phone: e.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      用餐需求
                      <select
                        value={registrantDrafts[order.id]?.mealChoice ?? ''}
                        onChange={(e) =>
                          updateRegistrantDraft(order.id, {
                            mealChoice: e.target.value,
                          })
                        }
                      >
                        <option value="">請選擇</option>
                        <option value="葷食">葷食</option>
                        <option value="素食">素食</option>
                        <option value="其他">其他</option>
                      </select>
                    </label>
                    {registrantDrafts[order.id]?.mealChoice === '其他' && (
                      <label>
                        請說明用餐需求
                        <input
                          value={registrantDrafts[order.id]?.mealCustom ?? ''}
                          onChange={(e) =>
                            updateRegistrantDraft(order.id, {
                              mealCustom: e.target.value,
                            })
                          }
                        />
                      </label>
                    )}
                    {(companionDrafts[order.id] ?? []).map(
                      (companion, index) => (
                        <div key={index} className="group-member-block">
                          <h4>
                            {order.buyingForFamily
                              ? `第 ${index + 1} 張`
                              : `第 ${index + 2} 張（同行親友）`}
                          </h4>
                          <label>
                            姓名
                            <input
                              value={companion.name}
                              onChange={(e) =>
                                updateCompanionDraft(order.id, index, {
                                  name: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label>
                            與您的關係
                            <select
                              value={companion.relationship}
                              onChange={(e) =>
                                updateCompanionDraft(order.id, index, {
                                  relationship: e.target.value,
                                })
                              }
                            >
                              <option value="">請選擇</option>
                              {COMPANION_RELATIONSHIPS.map((rel) => (
                                <option key={rel} value={rel}>
                                  {rel}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            用餐需求
                            <select
                              value={companion.mealChoice}
                              onChange={(e) =>
                                updateCompanionDraft(order.id, index, {
                                  mealChoice: e.target.value,
                                })
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
                                  updateCompanionDraft(order.id, index, {
                                    mealCustom: e.target.value,
                                  })
                                }
                              />
                            </label>
                          )}
                          <label>
                            備註
                            <input
                              value={companion.note}
                              onChange={(e) =>
                                updateCompanionDraft(order.id, index, {
                                  note: e.target.value,
                                })
                              }
                            />
                          </label>
                        </div>
                      ),
                    )}
                    <div className="button-row">
                      <button
                        disabled={savingId === order.id}
                        onClick={() => handleSaveRegistrantInfo(order)}
                      >
                        {savingId === order.id ? '儲存中…' : '儲存資料'}
                      </button>
                      <button
                        className="link-button"
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : eventAlreadyHappened(order) ? (
                  <p className="hint">活動已結束，無法再編輯報名資料</p>
                ) : (
                  <button onClick={() => startEditingRegistrant(order)}>
                    編輯票券資訊
                  </button>
                )}
              </div>
            )}
            {canCancel(order) ? (
              <>
                <button
                  className="danger-button"
                  disabled={cancellingId === order.id}
                  onClick={() => handleCancel(order)}
                >
                  {cancellingId === order.id ? '處理中…' : '退票'}
                </button>
                <p className="hint">
                  退票截止時間：{refundDeadline(order).toLocaleString()}
                </p>
              </>
            ) : (
              CANCELLABLE_STATUSES.includes(order.status) && (
                <p className="hint">
                  {batchClosed(order)
                    ? '此波次退票期限已過，無法自行退票'
                    : '已超過退票截止時間，無法自行退票'}
                </p>
              )
            )}
            {order.status === 'PAID' && (
              <div className="ticket-transfer-block">
                {order.transfers.length > 0 ? (
                  <>
                    <p className="hint">
                      轉讓邀請已送出給 {order.transfers[0].toUser.email}
                      ，等待對方確認
                    </p>
                    <p className="transfer-admin-notice">
                      {TRANSFER_ADMIN_NOTICE}
                    </p>
                    <button
                      className="link-button"
                      disabled={transferBusyId === order.id}
                      onClick={() =>
                        handleCancelTransfer(order.transfers[0].id, order.id)
                      }
                    >
                      {transferBusyId === order.id ? '處理中…' : '取消轉讓'}
                    </button>
                  </>
                ) : transferringId === order.id ? (
                  <div className="button-row">
                    <input
                      type="email"
                      placeholder="輸入對方已註冊的 email"
                      value={transferEmail}
                      onChange={(e) => setTransferEmail(e.target.value)}
                    />
                    <button
                      disabled={transferBusyId === order.id}
                      onClick={() => handleSubmitTransfer(order.id)}
                    >
                      {transferBusyId === order.id ? '送出中…' : '送出邀請'}
                    </button>
                    <button
                      className="link-button"
                      onClick={() => setTransferringId(null)}
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    className="link-button"
                    onClick={() => startTransfer(order.id)}
                  >
                    轉讓票券
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {reviewingTransferId &&
        (() => {
          const transfer = incomingTransfers.find(
            (t) => t.id === reviewingTransferId,
          );
          if (!transfer) return null;
          return (
            <div className="modal-overlay" onClick={cancelReviewAccept}>
              <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                <h2>📝轉讓表格📝</h2>
                <p className="hint">
                  {transfer.fromUser.email} 想將「
                  {transfer.order.ticketType.name}
                  」轉讓給您
                </p>
                <p className="transfer-admin-notice">{TRANSFER_ADMIN_NOTICE}</p>
                <label>
                  轉讓者姓名
                  <input
                    value={reviewFromName}
                    onChange={(e) => setReviewFromName(e.target.value)}
                  />
                </label>
                <label>
                  受讓者姓名
                  <input
                    value={reviewToName}
                    onChange={(e) => setReviewToName(e.target.value)}
                  />
                </label>
                <label>
                  葷／素
                  <input
                    value={reviewMeal}
                    onChange={(e) => setReviewMeal(e.target.value)}
                  />
                </label>
                <label>
                  夥伴／親友
                  <select
                    value={reviewBuyerType}
                    onChange={(e) =>
                      setReviewBuyerType(e.target.value as BuyerType | '')
                    }
                  >
                    <option value="">請選擇</option>
                    {BUYER_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                {error && <p className="error">{error}</p>}
                <div className="button-row">
                  <button
                    disabled={respondingTransferId === transfer.id}
                    onClick={() => handleConfirmAccept(transfer.id)}
                  >
                    {respondingTransferId === transfer.id ? '處理中…' : '確認'}
                  </button>
                  <button
                    className="link-button"
                    disabled={respondingTransferId === transfer.id}
                    onClick={() => handleRejectIncoming(transfer.id)}
                  >
                    拒絕
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
    </div>
  );
}
