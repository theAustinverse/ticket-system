import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { EventSummary } from '../api/types';

export function EventListPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listEvents().then((data) => {
      setEvents(data);
      setLoading(false);
    });
  }, []);

  if (loading) return <div className="page">載入中…</div>;

  return (
    <div className="page">
      <h1>活動列表</h1>
      {events.length === 0 && <p>目前沒有活動</p>}
      <ul className="event-list">
        {events.map((event) => (
          <li key={event.id}>
            <Link to={`/events/${event.id}`} className="event-card">
              <h2>{event.name}</h2>
              {event.description && <p>{event.description}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
