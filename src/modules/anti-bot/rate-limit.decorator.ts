import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  limit: number;
  windowSeconds: number;
}

/** Overrides the default rate limit for a specific route. */
export const RateLimit = (limit: number, windowSeconds: number) =>
  SetMetadata(RATE_LIMIT_KEY, { limit, windowSeconds } as RateLimitOptions);
