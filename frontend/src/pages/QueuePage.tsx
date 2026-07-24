import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { RegistrationInfo } from '../api/types';

const POLL_INTERVAL_MS = 2500;

export function QueuePage() {
  const { ticketTypeId } = useParams<{ ticketTypeId: string }>();
  const location = useLocation();
  const locationState = location.state as
    | { registration?: RegistrationInfo; quantity?: number; passcode?: string }
    | null;
  const registration = locationState?.registration;
  const quantity = locationState?.quantity;
  const passcode = locationState?.passcode;
  const { token } = useAuth();
  const navigate = useNavigate();
  const [position, setPosition] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileIncomplete, setProfileIncomplete] = useState(false);
  const queueTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    if (!ticketTypeId) return;
    if (!registration) {
      navigate(`/register/${ticketTypeId}`);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        if (!queueTokenRef.current) {
          const { token: queueToken } = await api.enterQueue(
            token!,
            ticketTypeId!,
            passcode,
          );
          queueTokenRef.current = queueToken;
        }
        const status = await api.getQueueStatus(
          ticketTypeId!,
          queueTokenRef.current,
        );
        if (cancelled) return;

        if (status.state === 'admitted') {
          navigate(`/order/${ticketTypeId}`, {
            state: { queueToken: queueTokenRef.current, registration, quantity },
          });
          return;
        }
        if (status.state === 'waiting') {
          setPosition(status.position);
        }
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError && err.status === 403 && err.message.includes('設定')) {
            setProfileIncomplete(true);
            setError(err.message);
          } else {
            setError(
              err instanceof ApiError && err.status === 403
                ? '通行碼錯誤，請返回上一頁重新輸入'
                : '排隊失敗，請重新整理頁面再試一次',
            );
          }
        }
      }
    }
    poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ticketTypeId, token, navigate, registration, quantity, passcode]);

  return (
    <div className="page page-narrow">
      <h1>候位中</h1>
      {error && <p className="error">{error}</p>}
      {profileIncomplete && (
        <p>
          <Link to="/profile">前往設定頁面填寫個人資料 →</Link>
        </p>
      )}
      {!error && (
        <div className="queue-stage">
          <div className="queue-embers" aria-hidden="true">
            <span className="ember" />
            <span className="ember" />
            <span className="ember" />
            <span className="ember" />
            <span className="ember" />
            <span className="ember" />
          </div>
          <div className="queue-seal">
            <p className="queue-position">
              {position !== null ? `第 ${position} 位` : '入場中…'}
            </p>
          </div>
          <p className="queue-caption">今晚只對自己人，請不要關閉此頁面</p>
        </div>
      )}
    </div>
  );
}
