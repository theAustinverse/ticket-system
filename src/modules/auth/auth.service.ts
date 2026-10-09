import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt, timingSafeEqual } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CheckinLoginDto } from './dto/checkin-login.dto';

const SALT_ROUNDS = 10;
const VERIFICATION_TTL_SECONDS = 10 * 60;
/** Caps total guesses against a single registration's 6-digit code — not
 * per-IP, so this can't be bypassed by spreading guesses across many IPs. */
const MAX_VERIFICATION_ATTEMPTS = 5;
/** Caps failed password attempts per account before a temporary lockout. */
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;
const PASSWORD_RESET_TTL_SECONDS = 10 * 60;
/** Caps wrong guesses against a reset code — same reasoning as MAX_VERIFICATION_ATTEMPTS. */
const MAX_RESET_ATTEMPTS = 5;
/** Minimum gap between reset emails to one address, so the endpoint can't be
 * used to flood someone's inbox — per-address, not per-IP, so spreading the
 * requests across many IPs doesn't get around it. */
const PASSWORD_RESET_COOLDOWN_SECONDS = 60;
/** A door shift outlasts the 1h user session; long enough for one event day. */
const CHECKIN_TOKEN_TTL = '12h';

/** Identical for a registered and an unregistered address on purpose — see forgotPassword. */
const FORGOT_PASSWORD_RESPONSE = {
  message: 'If that email is registered, a reset code has been sent',
};

/** Matches only the synthetic accounts a load test creates — never a real user's address. */
const LOAD_TEST_EMAIL_PATTERN = /^loadtest\d+@gmail\.com$/i;

/** A valid-looking hash with no corresponding real password — bcrypt.compare
 * runs against this for a nonexistent user, so login takes the same amount
 * of time whether or not the email is registered (prevents timing-based
 * email enumeration). */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('not-a-real-password', SALT_ROUNDS);

interface PendingRegistration {
  passwordHash: string;
  code: string;
}

interface PendingPasswordReset {
  code: string;
  /** Bound to the account the code was issued for, not just the address —
   * User.email is unique case-sensitively, so two rows can differ only by
   * case while sharing one key (keys are lowercased) and, on Gmail, one inbox. */
  userId: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private pendingRegistrationKey(email: string) {
    return `pending-registration:${email.toLowerCase()}`;
  }

  private verificationAttemptsKey(email: string) {
    return `verification-attempts:${email.toLowerCase()}`;
  }

  private loginAttemptsKey(email: string) {
    return `login-attempts:${email.toLowerCase()}`;
  }

  private passwordResetKey(email: string) {
    return `password-reset:${email.toLowerCase()}`;
  }

  private passwordResetAttemptsKey(email: string) {
    return `password-reset-attempts:${email.toLowerCase()}`;
  }

  private passwordResetCooldownKey(email: string) {
    return `password-reset-cooldown:${email.toLowerCase()}`;
  }

  /**
   * Constant-time comparison for the 6-digit codes — a plain `!==` leaks how
   * many leading characters matched through response timing.
   */
  private codesMatch(expected: string, given: string): boolean {
    const a = Buffer.from(String(expected));
    const b = Buffer.from(String(given));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Increments a Redis failure counter, expiring it after `windowSeconds` from the first failure. */
  private async recordFailure(key: string, windowSeconds: number): Promise<number> {
    const attempts = await this.redis.incr(key);
    if (attempts === 1) {
      await this.redis.expire(key, windowSeconds);
    }
    return attempts;
  }

  /**
   * Starts registration: stashes the hashed password + a verification code
   * in Redis and emails the code, instead of creating the User row
   * immediately. The account only exists once verifyRegistration succeeds,
   * which is what proves the email address is really reachable by its owner.
   */
  async register(dto: RegisterDto) {
    // Case-insensitive: the pending/attempt keys in Redis are lowercased, so
    // "Victim@gmail.com" and "victim@gmail.com" would otherwise be two
    // accounts that share one verification and lockout state.
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: dto.email, mode: 'insensitive' } },
    });
    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');

    const pending: PendingRegistration = { passwordHash, code };
    await this.redis.set(
      this.pendingRegistrationKey(dto.email),
      JSON.stringify(pending),
      'EX',
      VERIFICATION_TTL_SECONDS,
    );

    const isLoadTest =
      process.env.LOAD_TEST_MODE === 'true' &&
      LOAD_TEST_EMAIL_PATTERN.test(dto.email);

    if (isLoadTest) {
      // Skip the real send entirely — 2000 concurrent registrations would
      // otherwise blow through Resend's quota and spam a domain that
      // doesn't actually own these addresses. The code goes straight back
      // to the caller instead, since there's no inbox to check it against.
      return { message: 'Verification code sent', email: dto.email, debugCode: code };
    }

    await this.emailService.sendVerificationCode(dto.email, code);

    return { message: 'Verification code sent', email: dto.email };
  }

  async verifyRegistration(dto: VerifyRegistrationDto) {
    const key = this.pendingRegistrationKey(dto.email);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new BadRequestException(
        'Verification code expired or not found, please register again',
      );
    }

    const pending: PendingRegistration = JSON.parse(raw);
    // Cap total guesses against this code — not per-IP, so spreading
    // attempts across many IPs doesn't help. The guess is counted *before*
    // it is compared (atomic INCR), so a burst of parallel requests can't
    // all slip through while the counter is still at zero. Exhausting the
    // cap kills the pending registration outright, closing the
    // account-takeover window (attacker registers a victim's email, then
    // brute-forces the code the victim received, to bind that email to an
    // attacker-chosen password) rather than just slowing it down.
    const attempts = await this.recordFailure(
      this.verificationAttemptsKey(dto.email),
      VERIFICATION_TTL_SECONDS,
    );
    if (attempts > MAX_VERIFICATION_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException(
        'Too many incorrect attempts — please register again',
      );
    }
    if (!this.codesMatch(pending.code, dto.code)) {
      if (attempts >= MAX_VERIFICATION_ATTEMPTS) {
        await this.redis.del(key);
        throw new BadRequestException(
          'Too many incorrect attempts — please register again',
        );
      }
      throw new BadRequestException('Incorrect verification code');
    }

    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) {
      await this.redis.del(key);
      throw new ConflictException('Email already registered');
    }

    const user = await this.prisma.user.create({
      data: { email: dto.email, passwordHash: pending.passwordHash },
    });
    await this.redis.del(key);

    return this.buildTokenResponse(user.id, user.email, user.role);
  }

  async login(dto: LoginDto) {
    const attemptsKey = this.loginAttemptsKey(dto.email);
    // Claim the attempt *before* the slow bcrypt compare, atomically (INCR).
    // Reading the counter first and only bumping it after a failure let a
    // burst of parallel requests all see "0 failures" and all get a guess.
    const attemptsSoFar = await this.recordFailure(attemptsKey, LOGIN_LOCKOUT_SECONDS);
    if (attemptsSoFar > MAX_LOGIN_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many failed login attempts — please try again in a few minutes',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Compare against a dummy hash when the user doesn't exist so this path
    // takes roughly the same time either way — otherwise a fast rejection
    // for "no such user" vs. a slower one for "wrong password" (bcrypt.compare
    // is deliberately slow) lets an attacker enumerate registered emails.
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.redis.del(attemptsKey);
    return this.buildTokenResponse(user.id, user.email, user.role);
  }

  /**
   * Starts a password reset: emails a one-time code to the address if it
   * belongs to an account. The response is the same whether or not it does —
   * a different answer for "no such account" would turn this into an oracle
   * for which emails are registered (login already goes to lengths to avoid
   * exactly that). The email itself is sent without being awaited, so the
   * response time doesn't give it away either.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true },
    });
    if (!user) {
      return FORGOT_PASSWORD_RESPONSE;
    }

    // Atomic (SET NX) so concurrent requests can't both slip past the
    // cooldown. A request inside the cooldown is dropped silently rather than
    // rejected, for the same no-oracle reason as above.
    const acquired = await this.redis.set(
      this.passwordResetCooldownKey(dto.email),
      '1',
      'EX',
      PASSWORD_RESET_COOLDOWN_SECONDS,
      'NX',
    );
    if (acquired !== 'OK') {
      return FORGOT_PASSWORD_RESPONSE;
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const pending: PendingPasswordReset = { code, userId: user.id };
    await this.redis.set(
      this.passwordResetKey(dto.email),
      JSON.stringify(pending),
      'EX',
      PASSWORD_RESET_TTL_SECONDS,
    );

    void this.emailService.sendPasswordResetCode(user.email, code).catch((err) => {
      this.logger.error(
        `Password reset email to ${user.email} was not sent: ${err instanceof Error ? err.message : err}`,
      );
    });

    return FORGOT_PASSWORD_RESPONSE;
  }

  /**
   * Completes a password reset. The wrong-guess counter is deliberately not
   * cleared when a fresh code is issued, so requesting new codes can't be
   * used to earn more guesses: an address gets at most MAX_RESET_ATTEMPTS
   * wrong guesses per window no matter how many codes are requested. Success
   * also lifts any login lockout, since the person has just proven they own
   * the inbox.
   */
  async resetPassword(dto: ResetPasswordDto) {
    const key = this.passwordResetKey(dto.email);
    const raw = await this.redis.get(key);
    if (!raw) {
      throw new BadRequestException(
        'Reset code expired or not found, please request a new one',
      );
    }

    const pending: PendingPasswordReset = JSON.parse(raw);
    // Counted before it is compared, atomically — see verifyRegistration.
    const attempts = await this.recordFailure(
      this.passwordResetAttemptsKey(dto.email),
      PASSWORD_RESET_TTL_SECONDS,
    );
    if (attempts > MAX_RESET_ATTEMPTS) {
      await this.redis.del(key);
      throw new BadRequestException(
        'Too many incorrect attempts — please request a new code',
      );
    }
    if (!this.codesMatch(pending.code, dto.code)) {
      if (attempts >= MAX_RESET_ATTEMPTS) {
        await this.redis.del(key);
        throw new BadRequestException(
          'Too many incorrect attempts — please request a new code',
        );
      }
      throw new BadRequestException('Incorrect reset code');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });
    if (!user || user.id !== pending.userId) {
      await this.redis.del(key);
      throw new BadRequestException(
        'Reset code expired or not found, please request a new one',
      );
    }

    const passwordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    // Single use: gone before anything else can replay it.
    await this.redis.del(key);
    await this.redis.del(this.passwordResetAttemptsKey(dto.email));
    await this.redis.del(this.loginAttemptsKey(dto.email));

    return { message: 'Password has been reset' };
  }

  /**
   * The back office login is intentionally decoupled from the User table —
   * it's a single shared credential set (not tied to any customer's email),
   * checked against env vars instead of Postgres.
   */
  async adminLogin(dto: AdminLoginDto) {
    const adminUsername = process.env.ADMIN_USERNAME;
    const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH;
    if (!adminUsername || !adminPasswordHash) {
      throw new UnauthorizedException('Admin login is not configured');
    }

    // There's only one admin account, so lock globally (not per-username) —
    // an attacker who doesn't already know the username gains nothing by
    // trying different ones, and a real admin locked out by an attack can
    // simply wait out the cooldown.
    const attemptsKey = 'admin-login-attempts';
    // Claim the attempt *before* the slow bcrypt compare, atomically (INCR).
    // Reading the counter first and only bumping it after a failure let a
    // burst of parallel requests all see "0 failures" and all get a guess.
    const attemptsSoFar = await this.recordFailure(attemptsKey, LOGIN_LOCKOUT_SECONDS);
    if (attemptsSoFar > MAX_LOGIN_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many failed login attempts — please try again in a few minutes',
      );
    }

    // Always run bcrypt.compare, even on a username mismatch, so a wrong
    // username doesn't return faster than a wrong password (timing side-channel).
    const passwordMatches = await bcrypt.compare(
      dto.password,
      adminPasswordHash,
    );
    if (dto.username !== adminUsername || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.redis.del(attemptsKey);
    const accessToken = this.jwtService.sign({
      sub: 'admin',
      email: adminUsername,
      role: 'ADMIN',
    });
    return { accessToken };
  }

  /**
   * Door-staff login: a second shared credential, separate from the back
   * office's, that only CheckinGuard accepts. Several volunteers share it,
   * so each enters their own name at login and it rides in the token onto
   * every check-in they record.
   *
   * Lockout is per client IP, not global like adminLogin's. On event day a
   * global lock is a denial of service: anyone could type five wrong
   * passwords and stop every scanner at the door from logging in. Per-IP,
   * a guesser only locks themselves out, and the route's own rate limit
   * still caps how fast any one IP can try.
   */
  async checkinLogin(dto: CheckinLoginDto, clientIp: string) {
    const username = process.env.CHECKIN_USERNAME;
    const passwordHash = process.env.CHECKIN_PASSWORD_HASH;
    if (!username || !passwordHash) {
      throw new UnauthorizedException('Check-in login is not configured');
    }

    const attemptsKey = `checkin-login-attempts:${clientIp}`;
    // Claim the attempt *before* the slow bcrypt compare, atomically (INCR).
    // Reading the counter first and only bumping it after a failure let a
    // burst of parallel requests all see "0 failures" and all get a guess.
    const attemptsSoFar = await this.recordFailure(attemptsKey, LOGIN_LOCKOUT_SECONDS);
    if (attemptsSoFar > MAX_LOGIN_ATTEMPTS) {
      throw new UnauthorizedException(
        'Too many failed login attempts — please try again in a few minutes',
      );
    }

    // Always compare, even on a username mismatch (same timing reason as adminLogin).
    const passwordMatches = await bcrypt.compare(dto.password, passwordHash);
    if (dto.username !== username || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.redis.del(attemptsKey);
    const accessToken = this.jwtService.sign(
      {
        sub: 'checkin',
        email: username,
        role: 'CHECKIN',
        name: dto.staffName.trim(),
      },
      { expiresIn: CHECKIN_TOKEN_TTL },
    );
    return { accessToken };
  }

  private buildTokenResponse(userId: string, email: string, role: string) {
    const accessToken = this.jwtService.sign({ sub: userId, email, role });
    return { accessToken };
  }
}
