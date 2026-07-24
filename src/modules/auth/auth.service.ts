import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyRegistrationDto } from './dto/verify-registration.dto';
import { AdminLoginDto } from './dto/admin-login.dto';

const SALT_ROUNDS = 10;
const VERIFICATION_TTL_SECONDS = 10 * 60;
/** Caps total guesses against a single registration's 6-digit code — not
 * per-IP, so this can't be bypassed by spreading guesses across many IPs. */
const MAX_VERIFICATION_ATTEMPTS = 5;
/** Caps failed password attempts per account before a temporary lockout. */
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;

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

@Injectable()
export class AuthService {
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
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
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
    if (pending.code !== dto.code) {
      // Cap total guesses against this code — not per-IP, so spreading
      // attempts across many IPs doesn't help. Exhausting the cap kills the
      // pending registration outright, closing the account-takeover window
      // (attacker registers a victim's email, then brute-forces the code
      // the victim received, to bind that email to an attacker-chosen
      // password) rather than just slowing it down.
      const attempts = await this.recordFailure(
        this.verificationAttemptsKey(dto.email),
        VERIFICATION_TTL_SECONDS,
      );
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
    const existingAttempts = Number((await this.redis.get(attemptsKey)) ?? 0);
    if (existingAttempts >= MAX_LOGIN_ATTEMPTS) {
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
      await this.recordFailure(attemptsKey, LOGIN_LOCKOUT_SECONDS);
      throw new UnauthorizedException('Invalid credentials');
    }

    await this.redis.del(attemptsKey);
    return this.buildTokenResponse(user.id, user.email, user.role);
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
    const existingAttempts = Number((await this.redis.get(attemptsKey)) ?? 0);
    if (existingAttempts >= MAX_LOGIN_ATTEMPTS) {
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
      await this.recordFailure(attemptsKey, LOGIN_LOCKOUT_SECONDS);
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

  private buildTokenResponse(userId: string, email: string, role: string) {
    const accessToken = this.jwtService.sign({ sub: userId, email, role });
    return { accessToken };
  }
}
