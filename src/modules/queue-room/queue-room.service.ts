import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Not secret-grade — just a speed bump so someone who only holds
 * individual-ticket eligibility doesn't wander into the group-ticket queue
 * by mistake. Every order still records who bought what for admin review.
 */
const GROUP_TICKET_PASSCODE = process.env.GROUP_TICKET_PASSCODE ?? '142857';

/**
 * Target sustained admission throughput, independent of how often the tick
 * actually fires. This is purely a pacing/UX knob — correctness against
 * overselling is guaranteed entirely by the atomic Redis stock decrement in
 * InventoryService, not by how fast people are let through here. Tune this
 * up freely to shorten wait times without risking oversell.
 */
const ADMIT_RATE_PER_SECOND = 200;
/** How often the admission loop runs (best-effort; may fire late under load). */
const ADMIT_INTERVAL_MS = 1000;
/** Safety cap so a huge elapsed gap (e.g. after a GC pause) can't admit everyone at once. */
const MAX_ADMIT_PER_TICK = ADMIT_RATE_PER_SECOND * 10;
/** How long an admitted token stays valid before it must re-queue. */
const ADMITTED_TTL_SECONDS = 5 * 60;
/**
 * How long a token's owner binding survives — must comfortably outlast the
 * longest realistic wait (queued + admitted) so it doesn't expire out from
 * under someone still waiting in line.
 */
const OWNER_TTL_SECONDS = 30 * 60;

export type QueueStatus =
  | { state: 'admitted' }
  | { state: 'waiting'; position: number }
  | { state: 'unknown' };

@Injectable()
export class QueueRoomService {
  private readonly logger = new Logger(QueueRoomService.name);
  private readonly lastAdmitAt = new Map<string, number>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private queueKey(ticketTypeId: string) {
    return `queue:${ticketTypeId}`;
  }

  private admittedKey(ticketTypeId: string, token: string) {
    return `admitted:${ticketTypeId}:${token}`;
  }

  /** Binds a queue token to whichever user requested it, so it can't be forwarded/shared to let someone else skip the line. */
  private ownerKey(ticketTypeId: string, token: string) {
    return `owner:${ticketTypeId}:${token}`;
  }

  /**
   * Enrolls a new participant into the waiting line and returns their
   * token. If the ticket type gates entry behind a passcode, the caller
   * must supply the matching one first. Also requires the caller's profile
   * (name/team/lineId/phone) to be fully filled in — an account with blank
   * profile fields is otherwise indistinguishable from a half-abandoned
   * registration by the time admin reviews it, so ticket eligibility is
   * withheld until those fields are set.
   */
  async enter(
    ticketTypeId: string,
    userId: string,
    passcode?: string,
  ): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, team: true, lineId: true, phone: true },
    });
    if (!user?.name || !user?.team || !user?.lineId || !user?.phone) {
      throw new ForbiddenException(
        '請先至「設定」頁面完成個人資料填寫，才能進行搶票',
      );
    }

    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
      select: { requiresPasscode: true },
    });
    if (ticketType?.requiresPasscode && passcode !== GROUP_TICKET_PASSCODE) {
      throw new ForbiddenException('Incorrect passcode');
    }

    const token = randomUUID();
    await this.redis.zadd(this.queueKey(ticketTypeId), Date.now(), token);
    await this.redis.set(
      this.ownerKey(ticketTypeId, token),
      userId,
      'EX',
      OWNER_TTL_SECONDS,
    );
    return token;
  }

  /** True only if `token` was issued to `userId` — otherwise a forwarded/shared token could let someone else use it to skip the line. */
  async isOwnedBy(
    ticketTypeId: string,
    token: string,
    userId: string,
  ): Promise<boolean> {
    const owner = await this.redis.get(this.ownerKey(ticketTypeId, token));
    return owner === userId;
  }

  async getStatus(ticketTypeId: string, token: string): Promise<QueueStatus> {
    const admitted = await this.redis.exists(
      this.admittedKey(ticketTypeId, token),
    );
    if (admitted) return { state: 'admitted' };

    const rank = await this.redis.zrank(this.queueKey(ticketTypeId), token);
    if (rank === null) return { state: 'unknown' };
    return { state: 'waiting', position: rank + 1 };
  }

  async isAdmitted(ticketTypeId: string, token: string): Promise<boolean> {
    const exists = await this.redis.exists(
      this.admittedKey(ticketTypeId, token),
    );
    return exists === 1;
  }

  /**
   * Consumes an admitted token after it's been spent on one successful
   * order — otherwise it stays valid for the rest of its TTL (up to 5
   * minutes) and the same admission can be replayed against the order API
   * in a loop, letting one admitted buyer take far more than their share
   * while everyone else is still waiting in line.
   */
  async consumeAdmission(ticketTypeId: string, token: string): Promise<void> {
    await this.redis.del(this.admittedKey(ticketTypeId, token));
  }

  /**
   * Periodically promotes the oldest waiting tokens for every active queue
   * into "admitted" state, gating how fast traffic reaches the order API.
   */
  @Interval(ADMIT_INTERVAL_MS)
  private async admitBatches() {
    const queueKeys = await this.redis.keys('queue:*');
    for (const queueKey of queueKeys) {
      const ticketTypeId = queueKey.slice('queue:'.length);
      await this.admitNext(ticketTypeId);
    }
  }

  /**
   * Admits enough tokens to cover the actual wall-clock time elapsed since
   * the last tick, rather than a fixed count per firing. This keeps
   * sustained throughput correct even if the event loop is busy and the
   * @Interval callback fires late or is skipped under heavy load.
   */
  private async admitNext(ticketTypeId: string) {
    const now = Date.now();
    const last = this.lastAdmitAt.get(ticketTypeId) ?? now - ADMIT_INTERVAL_MS;
    const elapsedMs = now - last;
    const batchSize = Math.min(
      MAX_ADMIT_PER_TICK,
      Math.max(1, Math.round((elapsedMs / 1000) * ADMIT_RATE_PER_SECOND)),
    );

    const tokens = await this.redis.zrange(
      this.queueKey(ticketTypeId),
      0,
      batchSize - 1,
    );
    this.lastAdmitAt.set(ticketTypeId, now);
    if (tokens.length === 0) return;

    const pipeline = this.redis.pipeline();
    for (const token of tokens) {
      pipeline.set(
        this.admittedKey(ticketTypeId, token),
        '1',
        'EX',
        ADMITTED_TTL_SECONDS,
      );
    }
    pipeline.zrem(this.queueKey(ticketTypeId), ...tokens);
    await pipeline.exec();
    this.logger.debug(`Admitted ${tokens.length} tokens for ${ticketTypeId}`);
  }
}
