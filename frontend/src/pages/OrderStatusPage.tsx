import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { Order } from '../api/types';

export function OrderStatusPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!orderId) return;
    api
      .getOrder(token, orderId)
      .then(setOrder)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : '載入訂單資料失敗，請重新整理再試一次'),
      );
  }, [orderId, token, navigate]);

  if (error) return <div className="page error">{error}</div>;
  if (!order) return <div className="page">載入中…</div>;

  return (
    <div className="page page-narrow">
      <h1>訂單狀態</h1>
      <p>訂單編號：{order.id}</p>
      <p>數量：{order.quantity} 張</p>
      <p>總金額：NT$ {order.totalAmount.toLocaleString()}</p>
      {order.status === 'PAID' && (
        <p className="success">訂票成功！確認信已寄送到您的信箱。</p>
      )}
      {order.status === 'CANCELLED' && (
        <p className="error">此訂單已退票</p>
      )}
    </div>
  );
}
