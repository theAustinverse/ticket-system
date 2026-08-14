import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import type { EventSummary } from '../api/types';
import eventPoster from '../assets/poster/event-poster.webp';

export function EventListPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { token } = useAuth();

  useEffect(() => {
    api
      .listEvents()
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : '載入活動列表失敗，請重新整理再試一次');
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="page">載入中…</div>;
  if (error) return <div className="page error">{error}</div>;

  return (
    <div className="page">
      <h1>活動列表</h1>
      {events.length === 0 && <p>目前沒有活動</p>}
      <ul className={`event-list ${token ? '' : 'event-list-guest'}`}>
        {events.map((event) => (
          <li key={event.id}>
            <Link
              to={`/events/${event.id}`}
              className={`event-card ${token ? '' : 'event-card-guest'}`}
            >
              {token && <h2>{event.name}</h2>}
              {token && event.description && <p>{event.description}</p>}
              {!token && (
                <div
                  className="event-card-poster"
                  style={{ backgroundImage: `url(${eventPoster})` }}
                />
              )}
            </Link>
          </li>
        ))}
        {token && (
          <li>
            <Link to="/trailer" className="event-card">
              <h2>TS年度盛會</h2>
              <p>史詩級鉅作，重磅登場</p>
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
