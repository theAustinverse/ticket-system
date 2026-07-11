export interface TicketType {
  id: string;
  sessionId: string;
  batchId: string;
  name: string;
  price: number;
  totalQuantity: number;
  fixedQuantity: number | null;
}

export interface SaleBatch {
  id: string;
  sessionId: string;
  name: string;
  saleStartAt: string | null;
  ticketTypes: TicketType[];
}

export interface EventSession {
  id: string;
  eventId: string;
  venue: string;
  startTime: string;
  batches: SaleBatch[];
}

export interface EventSummary {
  id: string;
  name: string;
  description: string | null;
}

export interface EventDetail extends EventSummary {
  sessions: EventSession[];
}

export type QueueStatus =
  | { state: 'admitted' }
  | { state: 'waiting'; position: number }
  | { state: 'unknown' };

export type OrderStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

export interface Order {
  id: string;
  userId: string;
  ticketTypeId: string;
  quantity: number;
  totalAmount: number;
  status: OrderStatus;
  expiresAt: string;
  createdAt: string;
}
