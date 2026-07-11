import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';

const POLL_INTERVAL_MS = 2500;

export function QueuePage() {
  const { ticketTypeId } = useParams<{ ticketTypeId: string }>();
  const { token } = useAuth();
  const navigate = useNavigate();
  const [position, setPosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const queueTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!ticketTypeId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        if (!queueTokenRef.current) {
          const { token: queueToken } = await api.enterQueue(ticketTypeId!);
          queueTokenRef.current = queueToken;
        }
        const status = await api.getQueueStatus(
          ticketTypeId!,
          queueTokenRef.current,
        );
        if (cancelled) return;

        if (status.state === 'admitted') {
          navigate(`/order/${ticketTypeId}`, {
            state: { queueToken: queueTokenRef.current },
          });
          return;
        }
        if (status.state === 'waiting') {
          setPosition(status.position);
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch {
        if (!cancelled) {
          setError('排隊失敗，請重新整理頁面再試一次');
        }
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticketTypeId, token, navigate]);

  return (
    <div className="page page-narrow">
      <h1>排隊中</h1>
      {error && <p className="error">{error}</p>}
      {!error && (
        <>
          <p>請不要關閉此頁面，系統會依序放行。</p>
          <p className="queue-position">
            {position !== null ? `目前排隊位置：第 ${position} 位` : '正在加入排隊…'}
          </p>
        </>
      )}
    </div>
  );
}
