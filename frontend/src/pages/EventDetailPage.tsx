import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { EventDetail, SaleBatch, TicketType } from '../api/types';

function batchStatus(batch: SaleBatch): { label: string; open: boolean } {
  if (!batch.saleStartAt) return { label: '開賣時間未定', open: false };
  const startsAt = new Date(batch.saleStartAt).getTime();
  if (startsAt > Date.now()) {
    return {
      label: `開賣時間：${new Date(batch.saleStartAt).toLocaleString()}`,
      open: false,
    };
  }
  return { label: '搶購中', open: true };
}

function TicketTypeRow({
  ticketType,
  open,
}: {
  ticketType: TicketType;
  open: boolean;
}) {
  const navigate = useNavigate();
  return (
    <div className="ticket-type-row">
      <div>
        <strong>{ticketType.name}</strong>
        <span className="price">NT$ {ticketType.price.toLocaleString()}</span>
        {ticketType.fixedQuantity && (
          <span className="badge">每次限購 {ticketType.fixedQuantity} 張</span>
        )}
      </div>
      <button
        disabled={!open}
        onClick={() => navigate(`/register/${ticketType.id}`)}
      >
        {open ? '搶票' : '尚未開賣'}
      </button>
    </div>
  );
}

export function EventDetailPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    api.getEvent(eventId).then((data) => {
      setEvent(data);
      setLoading(false);
    });
  }, [eventId]);

  if (loading) return <div className="page">載入中…</div>;
  if (!event) return <div className="page">找不到活動</div>;

  return (
    <div className="page">
      <h1>{event.name}</h1>
      {event.description && <p>{event.description}</p>}

      {event.sessions.map((session) => (
        <div key={session.id} className="session-block">
          <h2>
            {session.venue} · {new Date(session.startTime).toLocaleString()}
          </h2>
          {session.batches.map((batch) => {
            const status = batchStatus(batch);
            return (
              <div key={batch.id} className="batch-block">
                <h3>
                  {batch.name} <span className="batch-status">{status.label}</span>
                </h3>
                {batch.ticketTypes.map((tt) => (
                  <TicketTypeRow
                    key={tt.id}
                    ticketType={tt}
                    open={status.open}
                  />
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
