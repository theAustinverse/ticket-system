import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';

const DEFAULT_LIMIT = 20;
const DEFAULT_WINDOW_SECONDS = 10;

/**
 * Sliding-window-ish request throttle keyed by client IP + user (when
 * authenticated) + route, backed by a single atomic Redis Lua script.
 * Acts as the basic anti-bot line of defense against scripted request bursts.
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleInit {
  private script: string;
  private scriptSha: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async onModuleInit() {
    this.script = readFileSync(join(__dirname, 'rate-limit.lua'), 'utf-8');
    this.scriptSha = (await this.redis.script('LOAD', this.script)) as string;
  }

  /**
   * Redis's script cache is pure in-memory state, not persisted — a Redis
   * restart/redeploy independent of this container empties it, and every
   * subsequent EVALSHA using the SHA cached at boot fails with "NOSCRIPT
   * No matching script": an uncaught ReplyError that surfaces as a 500 on
   * every rate-limited route (this is exactly what took down admin login —
   * Redis restarted mid-session while the api container kept running, and
   * kept failing until the container itself happened to redeploy). On that
   * specific error, reload the script and retry once instead of throwing.
   */
  private async evalshaWithReload(
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    try {
      return await this.redis.evalsha(this.scriptSha, numKeys, ...args);
    } catch (err) {
      if (!(err instanceof Error) || !err.message.startsWith('NOSCRIPT')) {
        throw err;
      }
      this.scriptSha = (await this.redis.script(
        'LOAD',
        this.script,
      )) as string;
      return this.redis.evalsha(this.scriptSha, numKeys, ...args);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Load-test escape hatch: a k6 run from a single machine shares one IP,
    // which this guard would otherwise throttle into the ground regardless
    // of real backend capacity. Must be unset outside of an active test.
    if (process.env.LOAD_TEST_MODE === 'true') {
      return true;
    }

    const options =
      this.reflector.get<RateLimitOptions>(
        RATE_LIMIT_KEY,
        context.getHandler(),
      ) ?? { limit: DEFAULT_LIMIT, windowSeconds: DEFAULT_WINDOW_SECONDS };

    const request = context.switchToHttp().getRequest();
    const ip = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
    const userId = request.user?.userId ?? 'anon';
    const route = `${request.method}:${request.route?.path ?? request.url}`;
    const key = `ratelimit:${ip}:${userId}:${route}`;

    const count = (await this.evalshaWithReload(
      1,
      key,
      options.windowSeconds,
    )) as number;

    if (count > options.limit) {
      throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
