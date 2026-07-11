import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { TicketType } from '../api/types';

export function OrderPage() {
  const { ticketTypeId } = useParams<{ ticketTypeId: string }>();
  const location = useLocation();
  const queueToken = (location.state as { queueToken?: string } | null)
    ?.queueToken;
  const { token } = useAuth();
  const navigate = useNavigate();

  const [ticketType, setTicketType] = useState<TicketType | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!queueToken) {
      setError('請先透過排隊室進入下單頁面');
      return;
    }
    if (!ticketTypeId) return;
    api.getTicketType(ticketTypeId).then((tt) => {
      setTicketType(tt);
      if (tt.fixedQuantity) setQuantity(tt.fixedQuantity);
    });
  }, [ticketTypeId, token, queueToken, navigate]);

  async function handleSubmit() {
    if (!ticketTypeId || !queueToken || !token) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await api.createOrder(
        token,
        queueToken,
        ticketTypeId,
        quantity,
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

  if (!ticketType) return <div className="page">載入中…</div>;

  return (
    <div className="page page-narrow">
      <h1>確認訂單</h1>
      <p>
        <strong>{ticketType.name}</strong> · NT$
        {ticketType.price.toLocaleString()} / 張
      </p>
      <label>
        購買張數
        <input
          type="number"
          min={1}
          value={quantity}
          disabled={!!ticketType.fixedQuantity}
          onChange={(e) => setQuantity(Number(e.target.value))}
        />
      </label>
      {ticketType.fixedQuantity && (
        <p className="hint">此票種每次限購 {ticketType.fixedQuantity} 張</p>
      )}
      <p>總金額：NT$ {(ticketType.price * quantity).toLocaleString()}</p>
      {error && <p className="error">{error}</p>}
      <button onClick={handleSubmit} disabled={submitting}>
        {submitting ? '送出中…' : '確認下單'}
      </button>
    </div>
  );
}
