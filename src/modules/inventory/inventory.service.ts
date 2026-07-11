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

const STOCK_KEY_PREFIX = 'stock:';

@Injectable()
export class InventoryService implements OnModuleInit {
  private decrementScriptSha: string;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit() {
    const script = readFileSync(
      join(__dirname, 'lua', 'decrement-stock.lua'),
      'utf-8',
    );
    this.decrementScriptSha = (await this.redis.script(
      'LOAD',
      script,
    )) as string;
  }

  private stockKey(ticketTypeId: string) {
    return `${STOCK_KEY_PREFIX}${ticketTypeId}`;
  }

  /** Initializes (or resets) the sellable stock for a ticket type. */
  async initStock(ticketTypeId: string, quantity: number): Promise<void> {
    await this.redis.set(this.stockKey(ticketTypeId), quantity);
  }

  async getStock(ticketTypeId: string): Promise<number | null> {
    const value = await this.redis.get(this.stockKey(ticketTypeId));
    return value === null ? null : Number(value);
  }

  /**
   * Atomically checks and decrements stock via a single Lua script round trip.
   * Throws if stock is uninitialized or insufficient.
   */
  async decrementStock(
    ticketTypeId: string,
    quantity: number,
  ): Promise<number> {
    const result = await this.redis.evalsha(
      this.decrementScriptSha,
      1,
      this.stockKey(ticketTypeId),
      quantity,
    );
    const remaining = Number(result);

    if (remaining === -2) {
      throw new StockNotInitializedError(ticketTypeId);
    }
    if (remaining === -1) {
      throw new InsufficientStockError(ticketTypeId);
    }
    return remaining;
  }

  /** Releases previously decremented stock back (e.g. on order expiry/cancel). */
  async releaseStock(ticketTypeId: string, quantity: number): Promise<void> {
    await this.redis.incrby(this.stockKey(ticketTypeId), quantity);
  }
}
