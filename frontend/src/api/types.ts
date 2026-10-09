/** One of the fixedQuantity-1 additional group members (the leader is the 11th seat). */
export interface GroupMember {
  name: string;
  contact: string;
  mealPreference: string;
  /** 夥伴 or 夥伴的親友; absent on orders placed before it was asked. */
  kind?: 'PARTNER' | 'RELATIVE';
  /** For a 親友: the partner's seat (0 is the leader, 1..n the members). */
  relativeOfSeat?: number;
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
  /** Only meaningful on a fixedQuantity bundle — flat total charged instead of price * quantity. */
  groupBundleTotalAmount: number | null;
  /** Only populated on the event-detail response; null if stock isn't initialized. */
  remainingStock?: number | null;
  /** Populated on api.getTicketType and on orders (api.listMyOrders); not on the event-detail response (batch is the parent there instead). */
  batch?: { name: string; saleEndAt: string | null; transferEndAt: string | null };
}

export interface SaleBatch {
  id: string;
  sessionId: string;
  name: string;
  saleStartAt: string | null;
  /** When this wave's own sale window (purchases + refunds) closes, regardless of the next wave's open time. */
  saleEndAt: string | null;
  /** After this moment no new ticket transfer can be started for this wave's orders (null = no cutoff). */
  transferEndAt: string | null;
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
  /** The list endpoint includes each session's venue and time (but not its waves). */
  sessions?: { id: string; venue: string; startTime: string; mapUrl: string | null }[];
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
  /** True for a 第一波 (earliest-created batch) order — createTransfer rejects new transfers for these. */
  isFirstWave: boolean;
  /** One per QR code, in seat order. */
  seats: Seat[];
}

export type SeatRole = 'LEADER' | 'MEMBER' | 'SELF' | 'COMPANION';

export interface SeatHolder {
  /** Null when that seat's name was never filled in. */
  name: string | null;
  role: SeatRole;
  mealPreference: string | null;
  /** The order's 體系. */
  team: string | null;
  /** Group seats: "主揪", "夥伴" or "<夥伴>的親友"; null when never marked or not a group seat. */
  relation: string | null;
}

export interface Seat {
  id: string;
  seatIndex: number;
  token: string;
  checkedInAt: string | null;
  holder: SeatHolder;
  /** Given back to the pool when the wave closed with this member left blank — its QR won't get anyone in. */
  released: boolean;
}

export type SeatStatus = 'ORDER_NOT_ACTIVE' | 'SEAT_RELEASED' | 'CHECKED_IN' | 'VALID';

export type CheckInResult = 'CHECKED_IN' | 'ALREADY_CHECKED_IN' | 'ORDER_NOT_ACTIVE' | 'SEAT_RELEASED';

/** What door staff see for one seat. */
export interface CheckinSeat {
  id: string;
  seatIndex: number;
  seatCount: number;
  holder: SeatHolder;
  status: SeatStatus;
  checkedInAt: string | null;
  checkedInBy: string | null;
  orderId: string;
  ticketTypeName: string;
  buyerEmail: string;
  team: string;
}

/** One 體系 on the door roster: every seat that can come in, filed under the buyer's team. */
export interface RosterTeam {
  team: string;
  total: number;
  checkedIn: number;
  seats: CheckinSeat[];
}

/** The no-login share page's view of one seat. */
export interface PublicTicket {
  holderName: string | null;
  role: SeatRole;
  team: string | null;
  relation: string | null;
  seatIndex: number;
  seatCount: number;
  status: SeatStatus;
  checkedInAt: string | null;
  ticketTypeName: string;
  eventName: string;
  venue: string;
  startTime: string;
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
  /** True for an account that shared a Gmail inbox (dots / +tag aliases) with an older account when that was made impossible. */
  sharedMailbox: boolean;
  role: 'USER' | 'ADMIN';
  name: string | null;
  team: string | null;
  lineId: string | null;
  phone: string | null;
  createdAt: string;
  orders: AdminOrderSummary[];
}

/** One seat of an order as the back office sees it (resolved like the door does). */
export interface AdminSeat {
  seatIndex: number;
  name: string | null;
  mealPreference: string | null;
  relation: string | null;
  role: 'LEADER' | 'MEMBER' | 'SELF' | 'COMPANION';
  checkedInAt: string | null;
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
  buyingForFamily: boolean;
  seats: AdminSeat[];
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

export type SponsorshipStatus = 'PENDING' | 'RECEIVED' | 'CANCELLED';

/** A public contact person: everything here is shown to every visitor. */
export interface Contact {
  id: string;
  name: string;
  lineId: string | null;
  email: string | null;
  sortOrder: number;
}

export interface SponsorshipInfo {
  presets: number[];
  minAmount: number;
  maxAmount: number;
  paymentInfo: string | null;
}

export interface MySponsorship {
  id: string;
  amount: number;
  referenceCode: string;
  status: SponsorshipStatus;
  createdAt: string;
  reportedAt: string | null;
}

export interface CreatedSponsorship extends MySponsorship {
  paymentInfo: string | null;
}

export interface AdminSponsorship extends MySponsorship {
  donorName: string;
  donorEmail: string;
  confirmedAt: string | null;
}

export interface AdminSponsorshipList {
  totals: {
    received: number;
    pending: number;
    receivedCount: number;
    pendingCount: number;
  };
  sponsorships: AdminSponsorship[];
}

export interface HelpItem {
  id: string;
  question: string;
  status: 'BOT_ANSWERED' | 'ESCALATED' | 'ADMIN_ANSWERED';
  /** Admin's reply if there is one, else the bot's; null while waiting on the admin. */
  answer: string | null;
  answeredBy: 'BOT' | 'ADMIN' | null;
  createdAt: string;
  repliedAt: string | null;
}

export interface AdminHelpItem {
  id: string;
  askerName: string;
  user: { email: string };
  question: string;
  botAnswer: string | null;
  status: HelpItem['status'];
  adminReply: string | null;
  createdAt: string;
  repliedAt: string | null;
}
