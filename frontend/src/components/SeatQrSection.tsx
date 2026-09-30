import { useState } from 'react';
import type { OrderWithSession, Seat } from '../api/types';
import { formatTaipei, holderLabel, ticketUrl } from '../tickets';
import { TicketQr } from './TicketQr';

/**
 * The owner's entry QR codes for one order: one per seat. A group leader or
 * family buyer forwards each person their own link, so members who arrive on
 * their own can still get in without the leader standing at the door.
 * Collapsed by default — an 11-person bundle is eleven codes.
 */
export function SeatQrSection({ order }: { order: OrderWithSession }) {
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (order.status !== 'PAID' || !order.seats?.length) return null;
  const count = order.seats.filter((s) => !s.released).length;

  async function share(seat: Seat) {
    const url = ticketUrl(seat.token);
    const title = `入場票券：${seat.holder.name ?? `第 ${seat.seatIndex + 1} 位`}`;
    // The system share sheet (LINE etc.) where the phone has one; otherwise
    // copy the link. A dismissed share sheet throws — that's not an error.
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(seat.id);
      setTimeout(() => setCopiedId((id) => (id === seat.id ? null : id)), 2500);
    } catch {
      window.prompt('複製這個連結傳給對方：', url);
    }
  }

  return (
    <div className="ticket-transfer-block">
      <button onClick={() => setOpen(!open)}>
        {open ? '收起入場 QR Code' : `顯示入場 QR Code（${count} 張）`}
      </button>
      {open && (
        <>
          <p className="hint">
            活動當天出示給行政組掃描即可報到，每個 QR Code 只能報到一次。可以用「分享」把連結傳給同行的人，對方不需要登入就能打開自己的 QR Code——請只傳給本人。票券轉讓後，舊的 QR Code 會失效。
          </p>
          <div className="seat-grid">
            {order.seats.map((seat) => (
              <div
                key={seat.id}
                className={`seat-card${seat.released ? ' is-void' : ''}${seat.checkedInAt ? ' is-done' : ''}`}
              >
                <span className="seat-name">{holderLabel(seat.holder)}</span>
                <span className="hint">
                  第 {seat.seatIndex + 1} / {order.seats.length} 位
                </span>
                {seat.released ? (
                  <p className="error">此座位未登記姓名，已於波次截止時釋出，無法入場</p>
                ) : (
                  <>
                    <TicketQr token={seat.token} size={200} />
                    {seat.checkedInAt ? (
                      <p className="success">已於 {formatTaipei(seat.checkedInAt)} 報到</p>
                    ) : (
                      <button className="link-button" onClick={() => share(seat)}>
                        {copiedId === seat.id ? '已複製連結' : '分享給他'}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
