import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

/** How many waiting tokens are admitted into "can order" state per tick. */
const ADMIT_BATCH_SIZE = 20;
/** How often the admission loop runs. */
const ADMIT_INTERVAL_MS = 1000;
/** How long an admitted token stays valid before it must re-queue. */
const ADMITTED_TTL_SECONDS = 5 * 60;

export type QueueStatus =
  | { state: 'admitted' }
  | { state: 'waiting'; position: number }
  | { state: 'unknown' };

@Injectable()
export class QueueRoomService {
  private readonly logger = new Logger(QueueRoomService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private queueKey(ticketTypeId: string) {
    return `queue:${ticketTypeId}`;
  }

  private admittedKey(ticketTypeId: string, token: string) {
    return `admitted:${ticketTypeId}:${token}`;
  }

  /** Enrolls a new participant into the waiting line and returns their token. */
  async enter(ticketTypeId: string): Promise<string> {
    const token = randomUUID();
    await this.redis.zadd(this.queueKey(ticketTypeId), Date.now(), token);
    return token;
  }

  async getStatus(
    ticketTypeId: string,
    token: string,
  ): Promise<QueueStatus> {
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

  private async admitNext(ticketTypeId: string) {
    const tokens = await this.redis.zrange(
      this.queueKey(ticketTypeId),
      0,
      ADMIT_BATCH_SIZE - 1,
    );
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
