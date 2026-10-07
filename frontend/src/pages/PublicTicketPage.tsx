import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { PublicTicket } from '../api/types';
import { TicketQr } from '../components/TicketQr';
import { formatTaipei, holderLabel, holderNote, SEAT_STATUS_LABEL } from '../tickets';

/**
 * What a group member (or family member) opens from the link the buyer
 * shared. No login: the link itself is the ticket. Shows only this seat's
 * own name and the event — never the buyer's contact details.
 */
export function PublicTicketPage() {
  const { token = '' } = useParams();
  const [ticket, setTicket] = useState<PublicTicket | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getPublicTicket(token)
      .then(setTicket)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 404
            ? '找不到這張票券。連結可能打錯了，或票券已經轉讓給別人（轉讓後舊連結會失效），請向購票人索取最新連結。'
            : '載入失敗，請檢查網路後重新整理',
        ),
      );
  }, [token]);

  if (error) {
    return (
      <div className="page page-narrow">
        <h1>入場票券</h1>
        <p className="error">{error}</p>
      </div>
    );
  }
  if (!ticket) {
    return (
      <div className="page page-narrow">
        <p className="hint">載入中…</p>
      </div>
    );
  }

  const admittable = ticket.status === 'VALID' || ticket.status === 'CHECKED_IN';

  return (
    <div className="page page-narrow public-ticket">
      <h1>入場票券</h1>
      <p className="seat-name">{holderLabel({ name: ticket.holderName, role: ticket.role, mealPreference: null, team: ticket.team, relation: ticket.relation })}</p>
      {/* The member opening their own link isn't told "身分未填": that is the leader's to fix. */}
      {holderNote({ team: ticket.team, relation: ticket.relation, role: ticket.role }, { flagUnfilled: false }) && (
        <p className="seat-note">
          {holderNote({ team: ticket.team, relation: ticket.relation, role: ticket.role }, { flagUnfilled: false })}
        </p>
      )}
      <p className="hint">
        {ticket.eventName}・{ticket.ticketTypeName}・第 {ticket.seatIndex + 1} / {ticket.seatCount} 位
      </p>
      <p className="hint">
        {ticket.venue}｜{formatTaipei(ticket.startTime)}（台北時間）
      </p>
      {admittable ? (
        <>
          <TicketQr token={token} size={260} />
          {ticket.status === 'CHECKED_IN' && ticket.checkedInAt ? (
            <p className="success">已於 {formatTaipei(ticket.checkedInAt)} 報到</p>
          ) : (
            <p className="hint">活動當天請出示此 QR Code 給行政組掃描報到。建議先截圖保存，以免現場網路不穩。</p>
          )}
        </>
      ) : (
        <p className="error">{SEAT_STATUS_LABEL[ticket.status]}</p>
      )}
      <p className="hint">
        <Link to="/entry-guide">不知道怎麼入場？看多比的入場教學</Link>
      </p>
    </div>
  );
}
