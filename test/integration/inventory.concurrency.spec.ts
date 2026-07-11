import Redis from 'ioredis';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Integration test: requires a real Redis instance (docker-compose up -d redis).
 * Verifies that concurrent decrement attempts never oversell stock, by
 * replicating the exact Lua script used by InventoryService.
 */
describe('Inventory Lua script concurrency', () => {
  let redis: Redis;
  let scriptSha: string;
  const ticketTypeId = `test-${Date.now()}`;
  const stockKey = `stock:${ticketTypeId}`;
  const totalStock = 50;

  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    });
    const script = readFileSync(
      join(__dirname, '../../src/modules/inventory/lua/decrement-stock.lua'),
      'utf-8',
    );
    scriptSha = await redis.script('LOAD', script);
    await redis.set(stockKey, totalStock);
  });

  afterAll(async () => {
    await redis.del(stockKey);
    await redis.quit();
  });

  it('never sells more than the initialized stock under concurrent requests', async () => {
    const concurrentRequests = 200; // more requests than available stock
    const results = await Promise.all(
      Array.from({ length: concurrentRequests }, () =>
        redis.evalsha(scriptSha, 1, stockKey, 1),
      ),
    );

    const successCount = results.filter((r) => Number(r) >= 0).length;
    const remaining = Number(await redis.get(stockKey));

    expect(successCount).toBe(totalStock);
    expect(remaining).toBe(0);
  });
});
