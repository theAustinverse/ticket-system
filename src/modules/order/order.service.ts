import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { validateGroupMemberKinds } from './group-member-kinds';
import type { Companion } from './types/companion';
import { recordOrderHistory } from './order-history';
import {
  isSeatReleased,
  newTicketToken,
  seatHolder,
  ticketSeatsFor,
} from '../checkin/ticket-seats';

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
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly eventService: EventService,
    private readonly emailService: EmailService,
    private readonly queueRoomService: QueueRoomService,
  ) {}

  /** Email (falling back to the raw id) for OrderHistory's denormalized actorLabel. */
  private async actorLabelFor(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? userId;
  }

  /**
   * Orders on this account that hold a seat for the account holder
   * themselves: any group bundle (the leader is a seat) and any individual
   * order not placed on behalf of family. A family order holds no seat for
   * the buyer. Cancelled and expired orders hold nothing.
   */
  private ownSeatOrderWhere(userId: string) {
    return {
      userId,
      status: { in: ['PAID', 'PENDING'] as ('PAID' | 'PENDING')[] },
      buyingForFamily: false,
    };
  }

  private static readonly ONE_SEAT_MESSAGE =
    '每個帳號只能有一張本人的票。若是幫親友代訂，請勾選「幫親友代訂」並填寫親友的姓名';

  /**
   * Companion names must be Chinese, never the buyer's own, and never
   * repeated. The extra seats are for relatives and friends, named as
   * themselves: the buyer's own name is the one-seat rule's loophole. Used
   * both when buying and when editing the registration afterwards.
   */
  private static assertCompanionNames(
    registrantName: string,
    companions: { name: string }[],
  ) {
    const buyerName = registrantName.trim();
    const seen = new Set<string>();
    for (const companion of companions) {
      if (!CHINESE_NAME_REGEX.test(companion.name)) {
        throw new BadRequestException(
          'companion name must be Chinese characters only',
        );
      }
      const name = companion.name.trim();
      if (name === buyerName) {
        throw new BadRequestException(
          '親友的姓名不能和您本人相同，請填寫親友自己的姓名',
        );
      }
      if (seen.has(name)) {
        throw new BadRequestException(`親友姓名「${name}」重複填寫`);
      }
      seen.add(name);
    }
  }

  /**
   * This system only handles the ticket-grabbing/reservation itself — there
   * is no in-app payment step. A created order is immediately the final
   * successful state (PAID), and a confirmation email goes out right away.
   */
  async createOrder(userId: string, dto: CreateOrderDto, queueToken?: string) {
    if (!queueToken) return this.placeOrder(userId, dto, queueToken);

    // One order at a time per admission. Without this, N simultaneous
    // requests carrying the same admitted token all pass AdmissionGuard
    // before the first one spends it, and a family order (which isn't
    // serialised by the own-seat lock) would succeed N times.
    if (!(await this.queueRoomService.beginOrder(dto.ticketTypeId, queueToken))) {
      throw new ConflictException('這個排隊資格正在下單中，請勿重複送出');
    }
    try {
      return await this.placeOrder(userId, dto, queueToken);
    } finally {
      await this.queueRoomService
        .endOrder(dto.ticketTypeId, queueToken)
        .catch(() => {});
    }
  }

  private async placeOrder(userId: string, dto: CreateOrderDto, queueToken?: string) {
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
    let groupMembers = dto.groupMembers;
    // Whether this order puts a seat in the buyer's own name. Only a ticket
    // type that takes companions may be bought on behalf of family; for any
    // other type the flag is refused rather than quietly honoured, or it
    // would be a way round the one-seat rule.
    const buyingForFamily = dto.buyingForFamily ?? false;
    const takesOwnSeat = !buyingForFamily;
    try {
      if (buyingForFamily && !ticketType.maxQuantityPerOrder) {
        throw new BadRequestException('這個票種不開放幫親友代訂');
      }
      // Cheap early refusal, before any stock moves. The check that actually
      // holds under concurrent requests is the one inside the write below.
      if (
        takesOwnSeat &&
        (await this.prisma.order.count({ where: this.ownSeatOrderWhere(userId) })) >= 1
      ) {
        throw new BadRequestException(OrderService.ONE_SEAT_MESSAGE);
      }
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
        groupMembers = validateGroupMemberKinds(
          dto.groupMembers as GroupMember[],
          ticketType.fixedQuantity,
        );
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
          OrderService.assertCompanionNames(dto.registrantName, dto.companions);
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

      // A fixedQuantity bundle can charge an exact flat total instead of
      // price * quantity — e.g. an 11-ticket "10 free 1" bundle at 23,880,
      // which 11 * some per-seat integer price can never land on exactly.
      const totalAmount =
        ticketType.groupBundleTotalAmount ?? ticketType.price * dto.quantity;

      let order;
      try {
        order = await this.prisma.$transaction(async (tx) => {
          if (takesOwnSeat) {
            // Serialise this user's own-seat orders: two simultaneous requests
            // would otherwise both count zero and both write. The lock is
            // per account and released at commit, so other buyers never wait.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId}))`;
            const held = await tx.order.count({
              where: this.ownSeatOrderWhere(userId),
            });
            if (held >= 1) {
              throw new BadRequestException(OrderService.ONE_SEAT_MESSAGE);
            }
          }
          return tx.order.create({
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
              groupMembers: groupMembers as unknown as object[],
              companions: dto.companions as unknown as object[],
              buyingForFamily,
              childSeatCount: dto.childSeatCount ?? 0,
              // Created in the same statement as the order, so there's never an
              // order without its seats (or seats without an order) — and if
              // this whole create fails, the stock rollback below covers both.
              tickets: { create: ticketSeatsFor(dto.quantity) },
            },
          });
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

      await recordOrderHistory(this.prisma, {
        orderId: order.id,
        action: 'CREATED',
        actorUserId: userId,
        actorLabel: user.email,
        after: {
          registrantName: order.registrantName,
          registrantTeam: order.registrantTeam,
          registrantLineId: order.registrantLineId,
          registrantPhone: order.registrantPhone,
          mealPreference: order.mealPreference,
          quantity: order.quantity,
          groupMembers: order.groupMembers,
          companions: order.companions,
        },
      });

      const isLoadTest =
        process.env.LOAD_TEST_MODE === 'true' &&
        /^loadtest\d+@gmail\.com$/i.test(user.email);

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

      // Best-effort: a failed confirmation email shouldn't fail the order
      // that already succeeded. Skipped for synthetic load-test accounts,
      // same reasoning as the registration-code bypass in AuthService.
      if (!isLoadTest) {
        // Not awaited: the buyer shouldn't wait on the mail provider, and a
        // throw here must never reach the catch below (which would release
        // the group claim of an order that already exists).
        void Promise.resolve(
          this.emailService.sendOrderConfirmation(user.email, {
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
          }),
        ).catch(() => {});
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
    // adminNote is the back office's private memo about the order.
    const { adminNote: _adminNote, ...visible } = order;
    return visible;
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

    // A named member must say whether it is a 夥伴 or a 親友 (and whose).
    // This is also how orders placed before that was asked get filled in.
    const checkedMembers = validateGroupMemberKinds(
      groupMembers,
      order.ticketType.fixedQuantity,
    );

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        groupMembers: checkedMembers as unknown as object[],
        ...(childSeatCount !== undefined && { childSeatCount }),
      },
    });

    await recordOrderHistory(this.prisma, {
      orderId,
      action: 'GROUP_MEMBERS_UPDATED',
      actorUserId: userId,
      actorLabel: await this.actorLabelFor(userId),
      before: {
        groupMembers: order.groupMembers,
        childSeatCount: order.childSeatCount,
      },
      after: {
        groupMembers: updated.groupMembers,
        childSeatCount: updated.childSeatCount,
      },
    });

    return updated;
  }

  /**
   * Self-service edit of a non-group order's own registrant/companion info
   * after purchase — group tickets use updateGroupMembers instead. Unlike
   * that method, there's no batch-close cutoff here: nothing about this
   * data affects stock or StockSweepService, so the only real deadline is
   * the event itself having already happened.
   */
  async updateRegistrantInfo(
    userId: string,
    orderId: string,
    dto: {
      registrantName: string;
      registrantTeam: string;
      registrantLineId: string;
      registrantPhone: string;
      mealPreference: string;
      companions?: Companion[];
      childSeatCount?: number;
    },
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { ticketType: { include: { session: true } } },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.userId !== userId) {
      throw new ForbiddenException('This order does not belong to you');
    }
    if (order.ticketType.fixedQuantity !== null) {
      throw new BadRequestException(
        'This is a group ticket — edit its member list instead',
      );
    }
    if (Date.now() > order.ticketType.session.startTime.getTime()) {
      throw new BadRequestException(
        'This event has already happened — ticket info can no longer be edited',
      );
    }

    if (
      !order.buyingForFamily &&
      !CHINESE_NAME_REGEX.test(dto.registrantName)
    ) {
      throw new BadRequestException(
        'registrantName must be Chinese characters only',
      );
    }

    if (order.ticketType.maxQuantityPerOrder) {
      const requiredCompanions = order.buyingForFamily
        ? order.quantity
        : order.quantity - 1;
      if (requiredCompanions > 0) {
        if (!dto.companions || dto.companions.length !== requiredCompanions) {
          throw new BadRequestException(
            `companions must list exactly ${requiredCompanions} entries`,
          );
        }
        // Same rules as at purchase: editing must not be a way around them
        // (e.g. renaming a relative to the buyer's own name to hold a second
        // seat that the one-own-seat count never sees).
        OrderService.assertCompanionNames(dto.registrantName, dto.companions);
      }
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        registrantName: dto.registrantName,
        registrantTeam: dto.registrantTeam,
        registrantLineId: dto.registrantLineId,
        registrantPhone: dto.registrantPhone,
        mealPreference: dto.mealPreference,
        ...(dto.companions !== undefined && {
          companions: dto.companions as unknown as object[],
        }),
        ...(dto.childSeatCount !== undefined && {
          childSeatCount: dto.childSeatCount,
        }),
      },
    });

    await recordOrderHistory(this.prisma, {
      orderId,
      action: 'REGISTRANT_INFO_UPDATED',
      actorUserId: userId,
      actorLabel: await this.actorLabelFor(userId),
      before: {
        registrantName: order.registrantName,
        registrantTeam: order.registrantTeam,
        registrantLineId: order.registrantLineId,
        registrantPhone: order.registrantPhone,
        mealPreference: order.mealPreference,
        companions: order.companions,
        childSeatCount: order.childSeatCount,
      },
      after: {
        registrantName: updated.registrantName,
        registrantTeam: updated.registrantTeam,
        registrantLineId: updated.registrantLineId,
        registrantPhone: updated.registrantPhone,
        mealPreference: updated.mealPreference,
        companions: updated.companions,
        childSeatCount: updated.childSeatCount,
      },
    });

    return updated;
  }

  /**
   * `isFirstWave` lets the frontend hide the "轉讓票券" button for 第一波
   * orders without needing to see sibling batches itself — it reuses
   * isFirstWaveBatch so the UI's notion of "first wave" can never drift
   * from the one createTransfer actually enforces.
   */
  async listMyOrders(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: {
        ticketType: { include: { session: true, batch: true } },
        transfers: {
          where: { status: 'PENDING' },
          include: { toUser: { select: { email: true } } },
        },
        tickets: { orderBy: { seatIndex: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(
      orders.map(async ({ tickets, adminNote: _adminNote, ...order }) => ({
        ...order,
        isFirstWave: await this.isFirstWaveBatch(
          order.ticketType.sessionId,
          order.ticketType.batchId,
        ),
        // One entry per QR code, named the way the door will see it. Only
        // the owner reaches this, so the tokens are theirs to show or share.
        seats: tickets.map((ticket) => ({
          id: ticket.id,
          seatIndex: ticket.seatIndex,
          token: ticket.token,
          checkedInAt: ticket.checkedInAt,
          holder: seatHolder(order, ticket.seatIndex),
          released: isSeatReleased(order, ticket.seatIndex),
        })),
      })),
    );
  }

  /**
   * True if `batchId` is the earliest-created batch (by createdAt, id as
   * tiebreaker) among its session's SaleBatch rows — the same "wave order"
   * convention StockSweepService already uses to infer wave numbers, since
   * SaleBatch has no explicit wave-number field, only a freely-editable
   * `name`. Matching on creation order rather than the string "第一波"
   * keeps this working even if a batch gets renamed later.
   */
  private async isFirstWaveBatch(sessionId: string, batchId: string): Promise<boolean> {
    const siblingBatches = await this.prisma.saleBatch.findMany({
      where: { sessionId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return siblingBatches[0]?.id === batchId;
  }

  /**
   * Starts a whole-order ownership transfer to another registered account.
   * Nothing changes hands yet — the recipient must accept via
   * acceptTransfer for Order.userId to actually change. Available around
   * the clock regardless of the ticket's own batch close time — unlike
   * cancellation/member-list edits, a transfer doesn't touch stock, so
   * there's no sweep-related reason to cut it off at batch close.
   *
   * Exception: 第一波 (early-bird) orders can never start a new transfer —
   * a deliberate policy call, not a stock-safety one. This only blocks
   * *new* transfer requests; a transfer already PENDING before this policy
   * took effect still runs its course (accept/reject/cancel untouched).
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
    if (
      await this.isFirstWaveBatch(order.ticketType.sessionId, order.ticketType.batchId)
    ) {
      throw new BadRequestException('第一波票券已停止轉讓功能');
    }
    const { transferEndAt } = order.ticketType.batch;
    if (transferEndAt && Date.now() >= transferEndAt.getTime()) {
      throw new BadRequestException('轉讓功能已截止');
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

    let transfer;
    try {
      transfer = await this.prisma.ticketTransfer.create({
        data: { orderId, fromUserId: userId, toUserId: toUser.id },
      });
    } catch (error: any) {
      // The findFirst above is only a courtesy: two simultaneous requests
      // both pass it. A partial unique index (one PENDING row per order) is
      // what really guarantees a single open invitation.
      if (error?.code === 'P2002') {
        throw new BadRequestException(
          'This order already has a pending transfer — cancel it first',
        );
      }
      throw error;
    }

    await recordOrderHistory(this.prisma, {
      orderId,
      action: 'TRANSFER_CREATED',
      actorUserId: userId,
      actorLabel: fromUser!.email,
      after: { transferId: transfer.id, toEmail: toUser.email },
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
        // The recipient hasn't accepted anything yet, so they get only what
        // the invitation needs — not the sender's phone, LINE ID, member
        // contacts or the back office's note.
        order: {
          select: {
            id: true,
            quantity: true,
            totalAmount: true,
            mealPreference: true,
            buyingForFamily: true,
            ticketType: { include: { session: true } },
          },
        },
        fromUser: { select: { email: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Recipient accepts — this is the only point where Order.userId actually
   * changes. `notice` is what the recipient reviewed/edited in the accept
   * confirmation form; it's used for the admin reconciliation email as-is
   * (not re-derived from the DB), so a corrected name/meal preference
   * actually reaches the admin team instead of a stale one.
   */
  async acceptTransfer(
    userId: string,
    transferId: string,
    notice: {
      fromName: string;
      toName: string;
      mealPreference: string;
      buyingForFamily: boolean;
    },
  ) {
    const transfer = await this.prisma.ticketTransfer.findUnique({
      where: { id: transferId },
      include: {
        order: { include: { ticketType: { include: { batch: true } } } },
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
    // An invitation sent before the deadline can't be accepted after it.
    const transferEndAt = transfer.order.ticketType.batch?.transferEndAt;
    if (transferEndAt && Date.now() >= transferEndAt.getTime()) {
      throw new BadRequestException('轉讓功能已截止');
    }

    const previousOwnerId = transfer.order.userId;
    const { ticketType } = transfer.order;
    const isGroupBundle = ticketType.fixedQuantity != null;

    // "One group bundle per person per session" is enforced by a Redis claim
    // taken at purchase time and keyed by (session, owner) — so a transfer
    // has to carry the claim across with the ticket. Left alone, the
    // recipient never holds a claim of their own and could accept bundle
    // after bundle, while the sender stays locked out of ever buying another
    // one: the claim has no TTL, so nothing eventually frees it. Stake the
    // recipient's claim before the ownership change lands, so a recipient
    // who already has a bundle is turned away rather than handed a second.
    let claimedForRecipient = false;
    if (isGroupBundle) {
      claimedForRecipient = await this.inventory.claimGroupPurchase(
        ticketType.sessionId,
        userId,
      );
      if (!claimedForRecipient) {
        throw new BadRequestException(
          'You already hold a group ticket bundle for this session and cannot accept another',
        );
      }
    }

    // Every seat gets a fresh QR token in the same transaction as the
    // ownership change. The previous owner has seen — and may have
    // screenshotted or forwarded — every QR on this order; without this,
    // those old codes would still get someone through the door.
    //
    // Every write below is conditional, and the transaction aborts unless it
    // really changed one row: the checks above ran a moment ago on data that
    // someone else may have changed since (a second invitation for the same
    // order accepted first, the sender cancelling the transfer or the order),
    // and an unconditional update would hand the ticket over anyway.
    let updatedOrder;
    try {
      updatedOrder = await this.prisma.$transaction(async (tx) => {
        const accepted = await tx.ticketTransfer.updateMany({
          where: { id: transferId, status: 'PENDING' },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
        if (accepted.count !== 1) {
          throw new BadRequestException('This transfer is no longer pending');
        }
        const moved = await tx.order.updateMany({
          where: {
            id: transfer.orderId,
            userId: transfer.fromUserId,
            status: 'PAID',
          },
          data: { userId },
        });
        if (moved.count !== 1) {
          throw new BadRequestException('This order is no longer active');
        }
        const seats = await tx.ticket.findMany({
          where: { orderId: transfer.orderId },
          select: { id: true },
        });
        for (const seat of seats) {
          await tx.ticket.update({
            where: { id: seat.id },
            data: { token: newTicketToken() },
          });
        }
        // The ticket has a new owner: any other invitation still open for it
        // is void, and must not be acceptable by someone else later.
        await tx.ticketTransfer.updateMany({
          where: { orderId: transfer.orderId, status: 'PENDING' },
          data: { status: 'CANCELLED', respondedAt: new Date() },
        });
        return tx.order.findUniqueOrThrow({ where: { id: transfer.orderId } });
      });
    } catch (error) {
      // Ownership never moved — don't leave the recipient holding a claim
      // against a bundle they don't own.
      if (claimedForRecipient) {
        await this.inventory
          .releaseGroupPurchaseClaim(ticketType.sessionId, userId)
          .catch(() => {});
      }
      throw error;
    }

    // Only now that the ticket has actually left the previous owner does
    // their claim come free.
    if (isGroupBundle) {
      await this.inventory
        .releaseGroupPurchaseClaim(ticketType.sessionId, previousOwnerId)
        .catch(() => {});
    }

    await recordOrderHistory(this.prisma, {
      orderId: transfer.orderId,
      action: 'TRANSFER_ACCEPTED',
      actorUserId: userId,
      actorLabel: await this.actorLabelFor(userId),
      before: { userId: previousOwnerId },
      after: { userId, notice },
    });

    // Best-effort: the early-bird batch has already closed and been
    // manually reconciled into a spreadsheet, so the admin team needs to
    // hear about every completed transfer to fold it in by hand — a failed
    // notice shouldn't fail a transfer that already succeeded.
    await this.emailService.sendTransferAdminNotice(notice).catch(() => {});

    const { adminNote: _adminNote, ...visible } = updatedOrder;
    return visible;
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
    // Conditional on still PENDING: the recipient may be accepting at this
    // very moment, and a plain update would overwrite ACCEPTED with the
    // sender's CANCELLED while the ticket has already changed hands.
    const { count } = await this.prisma.ticketTransfer.updateMany({
      where: { id: transferId, status: 'PENDING' },
      data: { status: nextStatus, respondedAt: new Date() },
    });
    if (count !== 1) {
      throw new BadRequestException('This transfer is no longer pending');
    }
    const updated = await this.prisma.ticketTransfer.findUniqueOrThrow({
      where: { id: transferId },
    });

    await recordOrderHistory(this.prisma, {
      orderId: transfer.orderId,
      action: nextStatus === 'REJECTED' ? 'TRANSFER_REJECTED' : 'TRANSFER_CANCELLED',
      actorUserId: userId,
      actorLabel: await this.actorLabelFor(userId),
      before: { status: 'PENDING' },
      after: { status: nextStatus },
    });

    return updated;
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
      where: { id: orderId, userId, status: 'PAID' },
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
    // Once the seats are back in the pool the cancellation is final: failing
    // to free the leader's one-bundle claim must NOT put the order back to
    // PAID (that would sell the same seats twice). The worst case is that
    // this user can't buy another bundle until the claim is cleared by hand.
    if (order.ticketType.fixedQuantity !== null) {
      await this.inventory
        .releaseGroupPurchaseClaim(order.ticketType.sessionId, userId)
        .catch((error) =>
          this.logger.error(
            `Order ${orderId} cancelled and stock released, but the group-purchase claim for user ${userId} was not: ${error?.message ?? error}`,
          ),
        );
    }

    await recordOrderHistory(this.prisma, {
      orderId,
      action: 'CANCELLED',
      actorUserId: userId,
      actorLabel: await this.actorLabelFor(userId),
      before: { status: 'PAID' },
      after: { status: 'CANCELLED' },
    });

    return this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  }
}
