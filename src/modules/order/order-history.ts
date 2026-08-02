import type { PrismaService } from '../../prisma/prisma.service';

export type OrderHistoryAction =
  | 'CREATED'
  | 'REGISTRANT_INFO_UPDATED'
  | 'GROUP_MEMBERS_UPDATED'
  | 'CANCELLED'
  | 'TRANSFER_CREATED'
  | 'TRANSFER_ACCEPTED'
  | 'TRANSFER_REJECTED'
  | 'TRANSFER_CANCELLED'
  | 'ADMIN_NOTE_UPDATED';

interface RecordOrderHistoryParams {
  orderId: string;
  action: OrderHistoryAction;
  /** The registered account that performed the action, if any — null for admin-initiated actions. */
  actorUserId?: string | null;
  /** Display label captured at write time (typically an email), so it stays meaningful even if the account later changes. */
  actorLabel: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Best-effort: a history-write failure shouldn't fail the action that
 * already succeeded (same reasoning as the transfer/order confirmation
 * emails) — callers should call this after their own change already
 * committed, not rely on it for correctness.
 */
export async function recordOrderHistory(
  prisma: PrismaService,
  params: RecordOrderHistoryParams,
): Promise<void> {
  try {
    await prisma.orderHistory.create({
      data: {
        orderId: params.orderId,
        action: params.action,
        actorUserId: params.actorUserId ?? null,
        actorLabel: params.actorLabel,
        before: params.before === undefined ? undefined : (params.before as object),
        after: params.after === undefined ? undefined : (params.after as object),
      },
    });
  } catch {
    // Swallow — see doc comment above.
  }
}
