import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';

export class InsufficientStockError extends Error {
  constructor(ticketTypeId: string) {
    super(`Insufficient stock for ticket type ${ticketTypeId}`);
  }
}

export class StockNotInitializedError extends Error {
  constructor(ticketTypeId: string) {
    super(`Stock not initialized for ticket type ${ticketTypeId}`);
  }
}

export class GroupOrderCapReachedError extends Error {
  constructor(ticketTypeId: string) {
    super(`Group order cap reached for ticket type ${ticketTypeId}`);
  }
}

const STOCK_KEY_PREFIX = 'stock:';
const GROUP_COUNT_KEY_PREFIX = 'groupcount:';
const GROUP_CLAIM_KEY_PREFIX = 'groupclaim:';

@Injectable()
export class InventoryService implements OnModuleInit {
  private decrementScript: string;
  private decrementScriptSha: string;
  private decrementGroupScript: string;
  private decrementGroupScriptSha: string;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit() {
    this.decrementScript = readFileSync(
      join(__dirname, 'lua', 'decrement-stock.lua'),
      'utf-8',
    );
    this.decrementScriptSha = (await this.redis.script(
      'LOAD',
      this.decrementScript,
    )) as string;

    this.decrementGroupScript = readFileSync(
      join(__dirname, 'lua', 'decrement-group-stock.lua'),
      'utf-8',
    );
    this.decrementGroupScriptSha = (await this.redis.script(
      'LOAD',
      this.decrementGroupScript,
    )) as string;
  }

  /**
   * EVALSHA against a script cached at boot. Redis's script cache is pure
   * in-memory state, not persisted — a Redis restart/redeploy independent
   * of this container (which just happened in production: Redis restarted
   * mid-session while the api container kept running) empties it, and every
   * subsequent EVALSHA using the SHA cached from the old boot fails with
   * "NOSCRIPT No matching script" — an uncaught ReplyError that surfaced as
   * a 500 on every rate-limited or stock-decrementing request until the api
   * container itself happened to redeploy. On that specific error, reload
   * the script and retry exactly once rather than propagating it; any other
   * error (bad args, connection down, genuine stock rules) still throws.
   */
  private async evalshaWithReload(
    scriptSource: string,
    sha: string,
    onReload: (newSha: string) => void,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    try {
      return await this.redis.evalsha(sha, numKeys, ...args);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('NOSCRIPT')) {
        throw err;
      }
      const freshSha = (await this.redis.script(
        'LOAD',
        scriptSource,
      )) as string;
      onReload(freshSha);
      return this.redis.evalsha(freshSha, numKeys, ...args);
    }
  }

  /** `key` is a ticketTypeId for an independent ticket type, or a sharedStockKey for a pooled one. */
  private stockKey(key: string) {
    return `${STOCK_KEY_PREFIX}${key}`;
  }

  /** Always keyed by the group ticket type's own id — never shared, even when its stock is. */
  private groupCountKey(ticketTypeId: string) {
    return `${GROUP_COUNT_KEY_PREFIX}${ticketTypeId}`;
  }

  /** One claim per (session, user) — independent of which group ticket type within that session they bought. */
  private groupClaimKey(sessionId: string, userId: string) {
    return `${GROUP_CLAIM_KEY_PREFIX}${sessionId}:${userId}`;
  }

  /** Initializes (or resets) the sellable stock under `key`. */
  async initStock(key: string, quantity: number): Promise<void> {
    await this.redis.set(this.stockKey(key), quantity);
  }

  /** Like initStock, but a no-op if already initialized — for shared-pool setup, so the second ticket type sharing a key doesn't stomp on the first's already-decremented value. */
  async initStockIfAbsent(key: string, quantity: number): Promise<void> {
    await this.redis.setnx(this.stockKey(key), quantity);
  }

  async getStock(key: string): Promise<number | null> {
    const value = await this.redis.get(this.stockKey(key));
    return value === null ? null : Number(value);
  }

  async getGroupOrderCount(ticketTypeId: string): Promise<number> {
    const value = await this.redis.get(this.groupCountKey(ticketTypeId));
    return value === null ? 0 : Number(value);
  }

  /** Overwrites the group-order counter (e.g. when resyncing from real Postgres order data). */
  async setGroupOrderCount(ticketTypeId: string, count: number): Promise<void> {
    await this.redis.set(this.groupCountKey(ticketTypeId), count);
  }

  /**
   * Atomically checks and decrements stock via a single Lua script round trip.
   * Throws if stock is uninitialized or insufficient.
   */
  async decrementStock(key: string, quantity: number): Promise<number> {
    const result = await this.evalshaWithReload(
      this.decrementScript,
      this.decrementScriptSha,
      (sha) => (this.decrementScriptSha = sha),
      1,
      this.stockKey(key),
      quantity,
    );
    const remaining = Number(result);

    if (remaining === -2) {
      throw new StockNotInitializedError(key);
    }
    if (remaining === -1) {
      throw new InsufficientStockError(key);
    }
    return remaining;
  }

  /** Releases previously decremented stock back (e.g. on order expiry/cancel). */
  async releaseStock(key: string, quantity: number): Promise<void> {
    await this.redis.incrby(this.stockKey(key), quantity);
  }

  /**
   * Like decrementStock, but also atomically enforces and increments a
   * per-group-ticket-type bundle counter capped at maxGroupOrders — used
   * when a group ticket type shares its stock pool with an individual
   * ticket type and must additionally never exceed a fixed number of bundles.
   */
  async decrementGroupStock(
    stockPoolKey: string,
    ticketTypeId: string,
    quantity: number,
    maxGroupOrders: number,
  ): Promise<number> {
    const result = await this.evalshaWithReload(
      this.decrementGroupScript,
      this.decrementGroupScriptSha,
      (sha) => (this.decrementGroupScriptSha = sha),
      2,
      this.stockKey(stockPoolKey),
      this.groupCountKey(ticketTypeId),
      quantity,
      maxGroupOrders,
    );
    const remaining = Number(result);

    if (remaining === -2) {
      throw new StockNotInitializedError(stockPoolKey);
    }
    if (remaining === -3) {
      throw new GroupOrderCapReachedError(ticketTypeId);
    }
    if (remaining === -1) {
      throw new InsufficientStockError(stockPoolKey);
    }
    return remaining;
  }

  /** Releases previously decremented group stock and its bundle-count slot. */
  async releaseGroupStock(
    stockPoolKey: string,
    ticketTypeId: string,
    quantity: number,
  ): Promise<void> {
    await this.redis.incrby(this.stockKey(stockPoolKey), quantity);
    await this.redis.decr(this.groupCountKey(ticketTypeId));
  }

  /**
   * Atomically stakes this user's one-bundle-per-session claim (SET NX) —
   * a plain "does an existing PAID order already exist" read followed by a
   * separate create is a check-then-act race: two concurrent requests from
   * the same user can both pass the read before either has written, both
   * decrement stock, and both succeed, handing one person two bundles.
   * Returns false if the claim was already taken (whether by a still-PAID
   * order or a request currently in flight).
   */
  async claimGroupPurchase(
    sessionId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.redis.set(
      this.groupClaimKey(sessionId, userId),
      '1',
      'NX',
    );
    return result === 'OK';
  }

  /** Frees a claim taken by claimGroupPurchase — on order-creation failure, or on cancellation so the buyer may purchase again. */
  async releaseGroupPurchaseClaim(
    sessionId: string,
    userId: string,
  ): Promise<void> {
    await this.redis.del(this.groupClaimKey(sessionId, userId));
  }

  /**
   * Atomically reads the current stock and resets it to 0 in one round
   * trip (Redis GETSET) — used when sweeping a closed batch's leftover
   * capacity into the next wave. A plain GET followed by a separate
   * SET(0) would race with a concurrent decrement landing in between:
   * that decrement gets silently erased by the reset, while the stale
   * pre-decrement count still gets forwarded to the next wave — the same
   * seat ends up counted twice (once as a real order, once as swept
   * capacity).
   */
  async takeAllStock(key: string): Promise<number> {
    const previous = await this.redis.getset(this.stockKey(key), '0');
    return previous === null ? 0 : Number(previous);
  }
}
