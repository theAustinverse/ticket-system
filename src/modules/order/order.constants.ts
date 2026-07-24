/** Self-service cancellation closes this many days before the event starts. */
export const REFUND_CUTOFF_DAYS = 7;

/**
 * Shown to both sides of a ticket transfer while the early-bird batch is
 * being reconciled by hand — a transfer the admin team doesn't know about
 * risks leaving the recipient holding a ticket the door list doesn't
 * recognize.
 */
export const TRANSFER_ADMIN_NOTICE =
  '因早鳥波次搶票已結束，行政組進入訂單彙整階段，請有轉讓票卷者務必告知行政組夥伴，避免訂單轉讓不被承認，導致接收者的票卷不被承認，感謝配合。';
