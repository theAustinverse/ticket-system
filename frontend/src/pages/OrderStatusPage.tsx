import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Order } from '../api/types';

function formatCountdown(msRemaining: number) {
  if (msRemaining <= 0) return '已逾時';
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!orderId) return;
    api.getOrder(token, orderId).then(setOrder);
  }, [orderId, token, navigate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function handlePay() {
    if (!token || !orderId) return;
    setPaying(true);
    setError(null);
    try {
      const updated = await api.payOrder(token, orderId);
      setOrder(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '付款失敗');
    } finally {
      setPaying(false);
    }
  }

  if (!order) return <div className="page">載入中…</div>;

  const msRemaining = new Date(order.expiresAt).getTime() - now;

  return (
    <div className="page page-narrow">
      <h1>訂單狀態</h1>
      <p>訂單編號：{order.id}</p>
      <p>數量：{order.quantity} 張</p>
      <p>總金額：NT$ {order.totalAmount.toLocaleString()}</p>
      <p>狀態：{order.status}</p>
      {order.status === 'PENDING' && (
        <>
          <p>付款倒數：{formatCountdown(msRemaining)}</p>
          {error && <p className="error">{error}</p>}
          <button onClick={handlePay} disabled={paying || msRemaining <= 0}>
            {paying ? '處理中…' : '模擬付款'}
          </button>
        </>
      )}
      {order.status === 'EXPIRED' && (
        <p className="error">訂單已逾時釋放，請重新搶票</p>
      )}
      {order.status === 'PAID' && <p className="success">付款完成！</p>}
    </div>
  );
}
