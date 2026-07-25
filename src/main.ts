import 'dotenv/config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { corsOrigin } from './common/cors-origin';

async function bootstrap() {
  // LOAD_TEST_MODE disables the anti-bot rate limiter entirely (see
  // RateLimitGuard) — a single global switch with no other safeguard, so a
  // config-management slip that leaves it set in production would silently
  // remove all request throttling. Loud at boot so that's hard to miss.
  if (process.env.LOAD_TEST_MODE === 'true') {
    new Logger('Bootstrap').warn(
      'LOAD_TEST_MODE=true — the anti-bot rate limiter is DISABLED for all routes. This must never be set in production.',
    );
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Standard hardening HTTP response headers (HSTS, nosniff, frame-deny,
  // etc.). This is a JSON API that serves no HTML, so helmet's default CSP
  // has nothing to break — and its cross-origin resource policy would reject
  // the browser's cross-site XHR from the Vercel frontend, so disable that
  // one and let the existing CORS allow-list govern cross-origin access.
  app.use(
    helmet({ crossOriginResourcePolicy: false }),
  );
  // Don't advertise the framework (Express) in every response — one less
  // hint for an attacker fingerprinting the stack.
  app.disable('x-powered-by');
  // Railway's edge network proxies every request through an unknown number
  // of internal hops before it reaches this container — measured to be more
  // than one. `trust proxy: 1` (trust exactly one hop) therefore picked an
  // *intermediate* hop out of the X-Forwarded-For chain instead of the real
  // client, and that intermediate address isn't stable across requests,
  // which silently broke the anti-bot rate limiter's IP-keyed buckets.
  // `true` trusts the whole chain and always takes the leftmost (original
  // client) entry, which stays correct regardless of hop count.
  app.set('trust proxy', true);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({ origin: corsOrigin });
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
