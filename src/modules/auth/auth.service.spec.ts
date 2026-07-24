import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let prisma: any;
  let jwtService: any;
  let emailService: any;
  let redisStore: Map<string, string>;
  let redis: any;
  let service: AuthService;

  beforeEach(() => {
    redisStore = new Map();
    redis = {
      get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
      set: jest.fn(async (key: string, value: string) => {
        redisStore.set(key, value);
      }),
      del: jest.fn(async (key: string) => {
        redisStore.delete(key);
      }),
      incr: jest.fn(async (key: string) => {
        const next = Number(redisStore.get(key) ?? '0') + 1;
        redisStore.set(key, String(next));
        return next;
      }),
      expire: jest.fn(async () => 1),
    };
    prisma = { user: { findUnique: jest.fn(), create: jest.fn() } };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') };
    emailService = { sendVerificationCode: jest.fn() };
    service = new AuthService(prisma, jwtService, emailService, redis);
    delete process.env.LOAD_TEST_MODE;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
  });

  describe('verifyRegistration', () => {
    async function seedPending(email: string, code: string) {
      await redis.set(
        `pending-registration:${email.toLowerCase()}`,
        JSON.stringify({ passwordHash: 'hashed', code }),
      );
    }

    it('rejects an incorrect code without creating a user', async () => {
      await seedPending('victim@gmail.com', '123456');
      await expect(
        service.verifyRegistration({ email: 'victim@gmail.com', code: '000000' }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('kills the pending registration after MAX_VERIFICATION_ATTEMPTS wrong guesses', async () => {
      await seedPending('victim@gmail.com', '123456');
      for (let i = 0; i < 4; i++) {
        await expect(
          service.verifyRegistration({ email: 'victim@gmail.com', code: '000000' }),
        ).rejects.toThrow('Incorrect verification code');
      }
      // 5th wrong guess exhausts the cap and invalidates the pending registration.
      await expect(
        service.verifyRegistration({ email: 'victim@gmail.com', code: '000000' }),
      ).rejects.toThrow('Too many incorrect attempts');

      // Even the *correct* code no longer works — the registration is gone.
      await expect(
        service.verifyRegistration({ email: 'victim@gmail.com', code: '123456' }),
      ).rejects.toThrow('Verification code expired or not found');
    });

    it('succeeds with the correct code and creates the user', async () => {
      await seedPending('new@gmail.com', '654321');
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'new@gmail.com',
        role: 'USER',
      });

      const result = await service.verifyRegistration({
        email: 'new@gmail.com',
        code: '654321',
      });

      expect(prisma.user.create).toHaveBeenCalled();
      expect(result).toEqual({ accessToken: 'signed-jwt' });
    });
  });

  describe('login', () => {
    it('rejects a wrong password and records a failed attempt', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@gmail.com',
        passwordHash: await bcrypt.hash('correct-password', 4),
        role: 'USER',
      });

      await expect(
        service.login({ email: 'user@gmail.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(redisStore.get('login-attempts:user@gmail.com')).toBe('1');
    });

    it('locks the account out after MAX_LOGIN_ATTEMPTS failures, without a DB lookup', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@gmail.com',
        passwordHash: await bcrypt.hash('correct-password', 4),
        role: 'USER',
      });

      for (let i = 0; i < 5; i++) {
        await expect(
          service.login({ email: 'user@gmail.com', password: 'wrong-password' }),
        ).rejects.toThrow(UnauthorizedException);
      }

      prisma.user.findUnique.mockClear();
      await expect(
        service.login({ email: 'user@gmail.com', password: 'correct-password' }),
      ).rejects.toThrow('Too many failed login attempts');
      // Locked out before ever touching the database.
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('succeeds with the correct password and clears prior failures', async () => {
      const passwordHash = await bcrypt.hash('correct-password', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@gmail.com',
        passwordHash,
        role: 'USER',
      });
      redisStore.set('login-attempts:user@gmail.com', '3');

      const result = await service.login({
        email: 'user@gmail.com',
        password: 'correct-password',
      });

      expect(result).toEqual({ accessToken: 'signed-jwt' });
      expect(redisStore.has('login-attempts:user@gmail.com')).toBe(false);
    });

    it('takes the same code path for a nonexistent user as a wrong password (no email enumeration shortcut)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: 'nobody@gmail.com', password: 'whatever' }),
      ).rejects.toThrow('Invalid credentials');
      expect(redisStore.get('login-attempts:nobody@gmail.com')).toBe('1');
    });
  });

  describe('adminLogin', () => {
    beforeEach(async () => {
      process.env.ADMIN_USERNAME = 'admin';
      process.env.ADMIN_PASSWORD_HASH = await bcrypt.hash('admin-password', 4);
    });

    it('rejects a wrong password', async () => {
      await expect(
        service.adminLogin({ username: 'admin', password: 'wrong' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong username even with the right password (still runs bcrypt.compare)', async () => {
      await expect(
        service.adminLogin({ username: 'not-admin', password: 'admin-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('locks out globally after MAX_LOGIN_ATTEMPTS failures', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          service.adminLogin({ username: 'admin', password: 'wrong' }),
        ).rejects.toThrow(UnauthorizedException);
      }
      await expect(
        service.adminLogin({ username: 'admin', password: 'admin-password' }),
      ).rejects.toThrow('Too many failed login attempts');
    });

    it('succeeds with the correct credentials and returns an ADMIN-role token', async () => {
      const result = await service.adminLogin({
        username: 'admin',
        password: 'admin-password',
      });
      expect(result).toEqual({ accessToken: 'signed-jwt' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'admin', role: 'ADMIN' }),
      );
    });
  });
});
