/** One of the fixedQuantity-1 additional group members (the leader is the 11th seat). */
export interface GroupMember {
  name: string;
  contact: string;
  mealPreference: string;
}

/** One additional ticket (beyond the buyer's own) on a multi-quantity individual ticket type. */
export interface Companion {
  name: string;
  relationship: string;
  mealPreference: string;
  /** Required — identifies the real buyer's identity/team/contact for admin review. */
  note: string;
}

export interface ChatMessage {
  id: string;
  userId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface TicketType {
  id: string;
  sessionId: string;
  batchId: string;
  name: string;
  price: number;
  totalQuantity: number;
  fixedQuantity: number | null;
  /** Only set (and >1) for individual ticket types that allow buying more than one per order (e.g. on behalf of family members). */
  maxQuantityPerOrder: number | null;
  /** When true, entering this ticket type's queue requires a passcode (see api.enterQueue). */
  requiresPasscode: boolean;
  /** When set, this ticket type draws from a shared stock pool with every other ticket type carrying the same key. */
  sharedStockKey: string | null;
  /** Only meaningful when sharedStockKey is set — the full size of the shared pool. */
  poolTotalQuantity: number | null;
  /** Only meaningful on a shared-pool group ticket type — cap on how many bundles can be sold from the pool. */
  maxGroupOrders: number | null;
  /** Only populated on the event-detail response; null if stock isn't initialized. */
  remainingStock?: number | null;
  /** Populated on api.getTicketType and on orders (api.listMyOrders); not on the event-detail response (batch is the parent there instead). */
  batch?: { name: string; saleEndAt: string | null };
}

export interface SaleBatch {
  id: string;
  sessionId: string;
  name: string;
  saleStartAt: string | null;
  /** When this wave's own sale window (purchases + refunds) closes, regardless of the next wave's open time. */
  saleEndAt: string | null;
  ticketTypes: TicketType[];
}

export interface EventSession {
  id: string;
  eventId: string;
  venue: string;
  startTime: string;
  mapUrl: string | null;
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
  createdAt: string;
  registrantName: string;
  registrantTeam: string;
  registrantLineId: string;
  registrantPhone: string;
  mealPreference: string;
  groupLeaderName: string | null;
  groupLeaderLineId: string | null;
  groupLeaderPhone: string | null;
  groupMembers: GroupMember[] | null;
  companions: Companion[] | null;
  buyingForFamily: boolean;
  /** Survey only: 0 means no child seat needed. */
  childSeatCount: number;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  team: string | null;
  lineId: string | null;
  phone: string | null;
}

export interface ProfileInput {
  name: string;
  team: string;
  lineId: string;
  phone: string;
}

export interface RegistrationInfo {
  registrantName: string;
  registrantTeam: string;
  registrantLineId: string;
  registrantPhone: string;
  mealPreference: string;
  groupLeaderName?: string;
  groupLeaderLineId?: string;
  groupLeaderPhone?: string;
  groupMembers?: GroupMember[];
  companions?: Companion[];
  buyingForFamily?: boolean;
  /** Survey only: 0 (or omitted) means no child seat needed. */
  childSeatCount?: number;
}

export type TicketTransferStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED';

export interface TicketTransfer {
  id: string;
  orderId: string;
  fromUserId: string;
  toUserId: string;
  status: TicketTransferStatus;
  createdAt: string;
  respondedAt: string | null;
}

export interface OrderWithSession extends Order {
  ticketType: TicketType & { session: EventSession };
  /** Only ever contains PENDING transfers (see api.listMyOrders). */
  transfers: (TicketTransfer & { toUser: { email: string } })[];
}

export interface IncomingTransfer extends TicketTransfer {
  order: Order & { ticketType: TicketType & { session: EventSession } };
  fromUser: { email: string; name: string | null };
}

export interface AdminOrderSummary {
  id: string;
  quantity: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  mealPreference: string;
  adminNote: string | null;
  groupLeaderName: string | null;
  groupLeaderLineId: string | null;
  groupLeaderPhone: string | null;
  groupMembers: GroupMember[] | null;
  companions: Companion[] | null;
  ticketType: { name: string; price: number };
}

export interface AdminUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  name: string | null;
  team: string | null;
  lineId: string | null;
  phone: string | null;
  createdAt: string;
  orders: AdminOrderSummary[];
}

export interface AdminOrderRow {
  id: string;
  userId: string;
  userEmail: string;
  registrantName: string;
  registrantTeam: string;
  registrantLineId: string;
  registrantPhone: string;
  mealPreference: string;
  ticketTypeName: string;
  quantity: number;
  totalAmount: number;
  status: OrderStatus;
  createdAt: string;
  adminNote: string | null;
  groupLeaderName: string | null;
  groupLeaderLineId: string | null;
  groupLeaderPhone: string | null;
  groupMembers: GroupMember[] | null;
  companions: Companion[] | null;
}

export interface OrderHistoryEntry {
  id: string;
  orderId: string;
  action: string;
  actorUserId: string | null;
  actorLabel: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface AdminTeamStat {
  team: string;
  ticketCount: number;
  percentage: number;
  rank: number;
}
