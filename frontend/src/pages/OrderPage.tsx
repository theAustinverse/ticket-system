import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { RegistrationInfo, TicketType } from '../api/types';

export function OrderPage() {
  const { ticketTypeId } = useParams<{ ticketTypeId: string }>();
  const location = useLocation();
  const state = location.state as {
    queueToken?: string;
    registration?: RegistrationInfo;
    quantity?: number;
  } | null;
  const queueToken = state?.queueToken;
  const registration = state?.registration;
  const { token } = useAuth();
  const navigate = useNavigate();

  const [ticketType, setTicketType] = useState<TicketType | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Group bundles always buy fixedQuantity; a multi-buy individual ticket
  // (e.g. early-bird) carries the chosen quantity from RegistrationPage;
  // every other ticket type is capped at 1 per order.
  const quantity = ticketType?.fixedQuantity ?? state?.quantity ?? 1;

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!queueToken || !registration) {
      setError('請先透過排隊室進入下單頁面');
      return;
    }
    if (!ticketTypeId) return;
    api
      .getTicketType(ticketTypeId)
      .then(setTicketType)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入票種資料失敗，請重新整理再試一次'),
      );
  }, [ticketTypeId, token, queueToken, registration, navigate]);

  async function handleSubmit() {
    if (!ticketTypeId || !queueToken || !token || !registration) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await api.createOrder(
        token,
        queueToken,
        ticketTypeId,
        quantity,
        registration,
      );
      navigate(`/orders/${order.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : '下單失敗，請稍後再試',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !ticketType) {
    return (
      <div className="page page-narrow">
        <h1>下單</h1>
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!ticketType || !registration) return <div className="page">載入中…</div>;

  return (
    <div className="page page-narrow">
      <h1>確認訂單</h1>
      <p>
        <strong>{ticketType.name}</strong>
        {ticketType.batch && ` · ${ticketType.batch.name}`} · NT$
        {ticketType.price.toLocaleString()} / 張
      </p>
      {ticketType.fixedQuantity ? (
        <p className="hint">
          此票種為團體票，一次購買固定 {ticketType.fixedQuantity} 張（含您本人）
        </p>
      ) : quantity > 1 ? (
        <p className="hint">本次購買 {quantity} 張</p>
      ) : (
        <p className="hint">本次購買 1 張</p>
      )}
      <p>總金額：NT$ {(ticketType.price * quantity).toLocaleString()}</p>

      <h2>報名資料</h2>
      <p>
        {registration.registrantName} · {registration.registrantTeam}
        <br />
        LINE ID：{registration.registrantLineId} · 電話：
        {registration.registrantPhone}
      </p>
      {registration.buyingForFamily && (
        <p className="hint">以上為代訂人（您本人）的識別資料，非實際到場親友</p>
      )}
      {registration.groupMembers && (
        <>
          <p>
            主揪：{registration.groupLeaderName}（LINE：
            {registration.groupLeaderLineId}，電話：
            {registration.groupLeaderPhone}）
          </p>
          <p className="hint">
            其餘成員名單：
            {registration.groupMembers
              .map((m) => m.name || '（未填寫）')
              .join('、')}
          </p>
        </>
      )}
      {registration.companions && registration.companions.length > 0 && (
        <>
          <p className="hint">
            {registration.buyingForFamily ? '代訂親友' : '同行親友'}：
            {registration.companions
              .map(
                (c, i) =>
                  `第${i + (registration.buyingForFamily ? 1 : 2)}張 ${c.name || '（未填寫）'}（${c.relationship}）／備註：${c.note}`,
              )
              .join('、')}
          </p>
        </>
      )}
      {(registration.childSeatCount ?? 0) > 0 && (
        <p className="hint">兒童座椅需求：{registration.childSeatCount} 張（僅調查用，不另外收費）</p>
      )}

      {error && <p className="error">{error}</p>}
      <button onClick={handleSubmit} disabled={submitting}>
        {submitting ? '送出中…' : '確認下單'}
      </button>
    </div>
  );
}
