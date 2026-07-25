import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GroupOrderCapReachedError,
  InsufficientStockError,
  InventoryService,
  StockNotInitializedError,
} from '../inventory/inventory.service';
import { EventService, SaleNotOpenError } from '../event/event.service';
import { EmailService } from '../email/email.service';
import { QueueRoomService } from '../queue-room/queue-room.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { REFUND_CUTOFF_DAYS } from './order.constants';
import type { GroupMember } from './types/group-member';
import type { Companion } from './types/companion';

/** The leader occupies one of the fixedQuantity seats themselves. */
function otherMembersCount(fixedQuantity: number): number {
  return fixedQuantity - 1;
}

/** No English letters, digits, or symbols — Chinese characters only. */
const CHINESE_NAME_REGEX = /^[一-鿿]+$/;

/** A shared-pool group ticket type enforces both the pool AND an independent bundle-count cap. */
function usesGroupCap(ticketType: {
  fixedQuantity: number | null;
  maxGroupOrders?: number | null;
}): boolean {
  return ticketType.fixedQuantity != null && ticketType.maxGroupOrders != null;
}

function stockKeyFor(ticketType: {
  id: string;
  sharedStockKey: string | null;
}): string {
  return ticketType.sharedStockKey ?? ticketType.id;
}

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly eventService: EventService,
    private readonly emailService: EmailService,
    private readonly queueRoomService: QueueRoomService,
  ) {}

  /**
   * This system only handles the ticket-grabbing/reservation itself — there
   * is no in-app payment step. A created order is immediately the final
   * successful state (PAID), and a confirmation email goes out right away.
   */
  async createOrder(userId: string, dto: CreateOrderDto, queueToken?: string) {
    // A JWT can be structurally valid (e.g. the back office's admin token)
    // without corresponding to a real customer account. Fail clearly here
    // instead of letting it surface as a raw FK-constraint 500 later.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException(
        'Your session is invalid — please log out and log back in',
      );
    }

    const ticketType = await this.eventService.findTicketType(dto.ticketTypeId);

    try {
      await this.eventService.assertOnSale(dto.ticketTypeId);
    } catch (error) {
      if (error instanceof SaleNotOpenError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    // One group bundle per person per session — otherwise a single buyer
    // could snipe multiple 11-seat bundles (especially now that the member
    // list can be filled in any time before the next wave opens, making
    // speculative hoarding easier), starving other buyers of a ticket type
    // outright. Everything from here to the order actually persisting is
    // wrapped so any failure releases this claim — a plain "does a PAID
    // order already exist" read followed by a separate create would be a
    // check-then-act race: two concurrent requests from the same user could
    // both pass the read before either has written, both decrement stock,
    // and both succeed. The atomic Redis claim below closes that race
    // instead of merely narrowing it.
    let groupClaimAcquired = false;
    try {
      if (ticketType.fixedQuantity !== null) {
        const claimed = await this.inventory.claimGroupPurchase(
          ticketType.sessionId,
          userId,
        );
        if (!claimed) {
          throw new BadRequestException(
            'You may only purchase one group ticket bundle per person',
          );
        }
        groupClaimAcquired = true;

        if (dto.quantity !== ticketType.fixedQuantity) {
          throw new BadRequestException(
            `This ticket type must be purchased in bundles of ${ticketType.fixedQuantity}`,
          );
        }
        if (
          !dto.groupLeaderName ||
          !dto.groupLeaderLineId ||
          !dto.groupLeaderPhone
        ) {
          throw new BadRequestException(
            'Group leader name, LINE ID, and phone are required for this ticket type',
          );
        }
        // Fields may be left blank at order time — the deadline to fill them
        // all in is "before the next wave opens" (see StockSweepService), not
        // "at the moment of purchase" — but the array must still reserve
        // exactly one slot per *other* member (the leader is the 11th seat,
        // already covered by the groupLeader* fields above).
        const requiredMembers = otherMembersCount(ticketType.fixedQuantity);
        if (!dto.groupMembers || dto.groupMembers.length !== requiredMembers) {
          throw new BadRequestException(
            `groupMembers must list exactly ${requiredMembers} entries (blank fields are allowed for now)`,
          );
        }
      } else if (ticketType.maxQuantityPerOrder) {
        // This specific ticket type explicitly allows buying more than 1 per
        // order on behalf of family members (e.g. the early-bird individual
        // ticket) — names must be Chinese-only, regardless of quantity.
        const maxQuantity = ticketType.maxQuantityPerOrder;
        if (dto.quantity < 1 || dto.quantity > maxQuantity) {
          throw new BadRequestException(
            `This ticket type allows 1 to ${maxQuantity} tickets per order`,
          );
        }

        // buyingForFamily: every ticket (including #1) is on behalf of a
        // family member, so registrantName is just administrative buyer
        // identity (silently taken from the account profile) — not a
        // user-facing "ticket name" field, so it's exempt from the
        // Chinese-only check here (each companion name below still enforces it).
        if (
          !dto.buyingForFamily &&
          !CHINESE_NAME_REGEX.test(dto.registrantName)
        ) {
          throw new BadRequestException(
            'registrantName must be Chinese characters only',
          );
        }

        const requiredCompanions = dto.buyingForFamily
          ? dto.quantity
          : dto.quantity - 1;
        if (requiredCompanions > 0) {
          if (!dto.companions || dto.companions.length !== requiredCompanions) {
            throw new BadRequestException(
              `companions must list exactly ${requiredCompanions} entries`,
            );
          }
          for (const companion of dto.companions) {
            if (!CHINESE_NAME_REGEX.test(companion.name)) {
              throw new BadRequestException(
                'companion name must be Chinese characters only',
              );
            }
          }
        }
      } else {
        // Ordinary individual ticket type: capped at 1 per order.
        if (dto.quantity !== 1) {
          throw new BadRequestException(
            'This ticket type allows only 1 ticket per order',
          );
        }
      }

      const stockKey = stockKeyFor(ticketType);
      try {
        if (usesGroupCap(ticketType)) {
          await this.inventory.decrementGroupStock(
            stockKey,
            ticketType.id,
            dto.quantity,
            ticketType.maxGroupOrders!,
          );
        } else {
          await this.inventory.decrementStock(stockKey, dto.quantity);
        }
      } catch (error) {
        if (
          error instanceof InsufficientStockError ||
          error instanceof StockNotInitializedError
        ) {
          throw new BadRequestException(error.message);
        }
        if (error instanceof GroupOrderCapReachedError) {
          throw new BadRequestException(
            'The group ticket bundle cap has been reached',
          );
        }
        throw error;
      }

      const totalAmount = ticketType.price * dto.quantity;

      let order;
      try {
        order = await this.prisma.order.create({
          data: {
            userId,
            ticketTypeId: dto.ticketTypeId,
            quantity: dto.quantity,
            totalAmount,
            status: 'PAID',
            registrantName: dto.registrantName,
            registrantTeam: dto.registrantTeam,
            registrantLineId: dto.registrantLineId,
            registrantPhone: dto.registrantPhone,
            mealPreference: dto.mealPreference,
            groupLeaderName: dto.groupLeaderName,
            groupLeaderLineId: dto.groupLeaderLineId,
            groupLeaderPhone: dto.groupLeaderPhone,
            groupMembers: dto.groupMembers as unknown as object[],
            companions: dto.companions as unknown as object[],
            buyingForFamily: dto.buyingForFamily ?? false,
            childSeatCount: dto.childSeatCount ?? 0,
          },
        });
      } catch (error) {
        // Roll back the reservation if persisting the order fails.
        if (usesGroupCap(ticketType)) {
          await this.inventory.releaseGroupStock(
            stockKey,
            ticketType.id,
            dto.quantity,
          );
        } else {
          await this.inventory.releaseStock(stockKey, dto.quantity);
        }
        throw error;
      }

      const isLoadTest =
        process.env.LOAD_TEST_MODE === 'true' &&
        /^loadtest\d+@gmail\.com$/i.test(user.email);

      // Best-effort: a failed confirmation email shouldn't fail the order
      // that already succeeded. Skipped for synthetic load-test accounts,
      // same reasoning as the registration-code bypass in AuthService.
      if (!isLoadTest) {
        await this.emailService.sendOrderConfirmation(user.email, {
          orderId: order.id,
          ticketTypeName: ticketType.name,
          quantity: order.quantity,
          totalAmount: order.totalAmount,
          registrantName: order.registrantName,
          registrantTeam: order.registrantTeam,
          registrantLineId: order.registrantLineId,
          registrantPhone: order.registrantPhone,
          mealPreference: order.mealPreference,
          groupLeaderName: order.groupLeaderName,
          groupLeaderLineId: order.groupLeaderLineId,
          groupLeaderPhone: order.groupLeaderPhone,
          groupMembers: order.groupMembers as GroupMember[] | null,
          companions: order.companions as unknown as Companion[] | null,
          buyingForFamily: order.buyingForFamily,
          childSeatCount: order.childSeatCount,
        });
      }

      // Spend the admission — otherwise it stays valid for the rest of its
      // TTL and the same admitted queue token can be replayed against this
      // endpoint in a loop, letting one admitted buyer take far more than
      // their share while everyone else is still waiting in line. Best-effort:
      // the order has already succeeded, so a failure here shouldn't fail the
      // request (the token will still expire on its own via its TTL).
      if (queueToken) {
        await this.queueRoomService
          .consumeAdmission(dto.ticketTypeId, queueToken)
          .catch(() => {});
      }

      return order;
    } catch (error) {
      if (groupClaimAcquired) {
        await this.inventory
          .releaseGroupPurchaseClaim(ticketType.sessionId, userId)
          .catch(() => {});
      }
      throw error;
    }
  }

  /** Only the order's owner may view it — order ids are otherwise a bare lookup key, not a capability token. */
  async findOrder(userId: string, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    if (order.userId !== userId) {
      throw new ForbiddenException('This order does not belong to you');
    }
    return order;
  }

  /**
   * Lets a group-ticket leader fill in or correct their member list any
   * time after ordering — the deadline is the ticket's own batch closing
   * (SaleBatch.saleEndAt), not "at the moment of purchase". Past that point
   * StockSweepService may already have released any still-blank seats to the
   * next wave, so editing afterward could hand out a seat twice.
   */
  async updateGroupMembers(
    userId: string,
    orderId: string,
    groupMembers: GroupMember[],
    childSeatCount?: number,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { ticketType: { include: { session: true, batch: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.userId !== userId) {
      throw new ForbiddenException('This order does not belong to you');
    }
    if (order.ticketType.fixedQuantity === null) {
      throw new BadRequestException(
        'This order is not a group ticket and has no member list',
      );
    }
    if (Date.now() > order.ticketType.session.startTime.getTime()) {
      throw new BadRequestException(
        'This event has already happened — the member list can no longer be edited',
      );
    }
    const { saleEndAt } = order.ticketType.batch;
    if (saleEndAt && Date.now() >= saleEndAt.getTime()) {
      throw new BadRequestException(
        'This wave has closed — the member list can no longer be edited',
      );
    }
    const requiredMembers = otherMembersCount(order.ticketType.fixedQuantity);
    if (groupMembers.length !== requiredMembers) {
      throw new BadRequestException(
        `groupMembers must list exactly ${requiredMembers} entries`,
      );
    }

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        groupMembers: groupMembers as unknown as object[],
        ...(childSeatCount !== undefined && { childSeatCount }),
      },
    });
  }

  listMyOrders(userId: string) {
    return this.prisma.order.findMany({
      where: { userId },
      include: {
        ticketType: { include: { session: true, batch: true } },
        transfers: {
          where: { status: 'PENDING' },
          include: { toUser: { select: { email: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Starts a whole-order ownership transfer to another registered account.
   * Nothing changes hands yet — the recipient must accept via
   * acceptTransfer for Order.userId to actually change. Available around
   * the clock regardless of the ticket's own batch close time — unlike
   * cancellation/member-list edits, a transfer doesn't touch stock, so
   * there's no sweep-related reason to cut it off at batch close.
   */
  async createTransfer(userId: string, orderId: string, toEmail: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { ticketType: { include: { batch: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.userId !== userId) {
      throw new ForbiddenException('This order does not belong to you');
    }
    if (order.status !== 'PAID') {
      throw new BadRequestException(`Order ${orderId} cannot be transferred`);
    }

    const existingPending = await this.prisma.ticketTransfer.findFirst({
      where: { orderId, status: 'PENDING' },
    });
    if (existingPending) {
      throw new BadRequestException(
        'This order already has a pending transfer — cancel it first',
      );
    }

    const fromUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    const toUser = await this.prisma.user.findUnique({
      where: { email: toEmail },
    });
    if (!toUser) {
      throw new BadRequestException(
        'This email is not a registered account on this system',
      );
    }
    if (toUser.id === userId) {
      throw new BadRequestException('You cannot transfer a ticket to yourself');
    }

    const transfer = await this.prisma.ticketTransfer.create({
      data: { orderId, fromUserId: userId, toUserId: toUser.id },
    });

    await this.emailService.sendTransferInvite(toUser.email, {
      ticketTypeName: order.ticketType.name,
      fromEmail: fromUser!.email,
    });
    await this.emailService.sendTransferSentNotice(fromUser!.email, {
      ticketTypeName: order.ticketType.name,
      toEmail: toUser.email,
    });

    return transfer;
  }

  listIncomingTransfers(userId: string) {
    return this.prisma.ticketTransfer.findMany({
      where: { toUserId: userId, status: 'PENDING' },
      include: {
        order: { include: { ticketType: { include: { session: true } } } },
        fromUser: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Recipient accepts — this is the only point where Order.userId actually changes. */
  async acceptTransfer(userId: string, transferId: string) {
    const transfer = await this.prisma.ticketTransfer.findUnique({
      where: { id: transferId },
      include: {
        order: { include: { ticketType: { include: { batch: true } } } },
        fromUser: { select: { name: true } },
        toUser: { select: { name: true } },
      },
    });
    if (!transfer)
      throw new NotFoundException(`Transfer ${transferId} not found`);
    if (transfer.toUserId !== userId) {
      throw new ForbiddenException('This transfer is not addressed to you');
    }
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('This transfer is no longer pending');
    }
    if (transfer.order.status !== 'PAID') {
      throw new BadRequestException('This order is no longer active');
    }

    const [, updatedOrder] = await this.prisma.$transaction([
      this.prisma.ticketTransfer.update({
        where: { id: transferId },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      }),
      this.prisma.order.update({
        where: { id: transfer.orderId },
        data: { userId },
      }),
    ]);

    // Best-effort: the early-bird batch has already closed and been
    // manually reconciled into a spreadsheet, so the admin team needs to
    // hear about every completed transfer to fold it in by hand — a failed
    // notice shouldn't fail a transfer that already succeeded.
    await this.emailService
      .sendTransferAdminNotice({
        fromName: transfer.fromUser.name ?? '（未填寫）',
        toName: transfer.toUser.name ?? '（未填寫）',
        mealPreference: transfer.order.mealPreference,
        buyingForFamily: transfer.order.buyingForFamily,
      })
      .catch(() => {});

    return updatedOrder;
  }

  async rejectTransfer(userId: string, transferId: string) {
    return this.respondToTransfer(userId, transferId, 'toUserId', 'REJECTED');
  }

  async cancelTransfer(userId: string, transferId: string) {
    return this.respondToTransfer(
      userId,
      transferId,
      'fromUserId',
      'CANCELLED',
    );
  }

  private async respondToTransfer(
    userId: string,
    transferId: string,
    ownerField: 'toUserId' | 'fromUserId',
    nextStatus: 'REJECTED' | 'CANCELLED',
  ) {
    const transfer = await this.prisma.ticketTransfer.findUnique({
      where: { id: transferId },
    });
    if (!transfer)
      throw new NotFoundException(`Transfer ${transferId} not found`);
    if (transfer[ownerField] !== userId) {
      throw new ForbiddenException('This transfer does not belong to you');
    }
    if (transfer.status !== 'PENDING') {
      throw new BadRequestException('This transfer is no longer pending');
    }
    return this.prisma.ticketTransfer.update({
      where: { id: transferId },
      data: { status: nextStatus, respondedAt: new Date() },
    });
  }

  /**
   * Self-service cancellation: the requester must own the order, it must
   * still be in a cancellable state, the event must be more than
   * REFUND_CUTOFF_DAYS away, AND — if the ticket's own batch has a fixed
   * close date (SaleBatch.saleEndAt) — that date must not have passed yet.
   * The batch cutoff is normally the tighter of the two (e.g. an early-bird
   * wave closing weeks before the event itself would), since past it any
   * unsold/unclaimed capacity has already moved on to the next wave.
   * Releases the reserved stock back to the pool on success, same as an
   * admin-initiated deletion.
   */
  async cancelOrder(userId: string, orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { ticketType: { include: { session: true, batch: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.userId !== userId) {
      throw new ForbiddenException('This order does not belong to you');
    }
    if (order.status !== 'PAID') {
      throw new BadRequestException(`Order ${orderId} cannot be cancelled`);
    }

    const { saleEndAt } = order.ticketType.batch;
    if (saleEndAt && Date.now() >= saleEndAt.getTime()) {
      throw new BadRequestException(
        'This wave has closed — cancellation is no longer available',
      );
    }

    const cutoff = new Date(order.ticketType.session.startTime);
    cutoff.setDate(cutoff.getDate() - REFUND_CUTOFF_DAYS);
    if (Date.now() > cutoff.getTime()) {
      throw new BadRequestException(
        `Cancellation is only allowed until ${REFUND_CUTOFF_DAYS} days before the event`,
      );
    }

    // Conditional on status still being PAID — a plain read-then-update
    // would let the same order get cancelled twice concurrently (e.g. a
    // double-click, or a retried request), releasing its stock back to the
    // pool twice for a single seat.
    const { count } = await this.prisma.order.updateMany({
      where: { id: orderId, status: 'PAID' },
      data: { status: 'CANCELLED' },
    });
    if (count === 0) {
      throw new BadRequestException(`Order ${orderId} cannot be cancelled`);
    }

    const stockKey = stockKeyFor(order.ticketType);
    try {
      if (usesGroupCap(order.ticketType)) {
        await this.inventory.releaseGroupStock(
          stockKey,
          order.ticketType.id,
          order.quantity,
        );
      } else {
        await this.inventory.releaseStock(stockKey, order.quantity);
      }
      if (order.ticketType.fixedQuantity !== null) {
        await this.inventory.releaseGroupPurchaseClaim(
          order.ticketType.sessionId,
          userId,
        );
      }
    } catch (error) {
      // Best-effort revert so a failed stock release doesn't silently leave
      // the order CANCELLED with its seat never returned to the pool. A
      // hard crash between these two awaits (rather than a caught error)
      // can't be recovered from here — closing that residual gap needs a
      // cross-store transaction/outbox, out of scope for this fix.
      await this.prisma.order
        .update({ where: { id: orderId }, data: { status: 'PAID' } })
        .catch(() => {});
      throw error;
    }

    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  }
}
