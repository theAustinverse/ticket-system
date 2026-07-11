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
  private scriptSha: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async onModuleInit() {
    const script = readFileSync(join(__dirname, 'rate-limit.lua'), 'utf-8');
    this.scriptSha = (await this.redis.script('LOAD', script)) as string;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const count = (await this.redis.evalsha(
      this.scriptSha,
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
