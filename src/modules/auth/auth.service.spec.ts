import { BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
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
      // Honors NX (only set if absent) like real Redis; anything else overwrites.
      set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes('NX') && redisStore.has(key)) return null;
        redisStore.set(key, value);
        return 'OK';
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
    prisma = { user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() } };
    jwtService = { sign: jest.fn().mockReturnValue('signed-jwt') };
    emailService = {
      sendVerificationCode: jest.fn(),
      sendPasswordResetCode: jest.fn().mockResolvedValue(undefined),
    };
    service = new AuthService(prisma, jwtService, emailService, redis);
    delete process.env.LOAD_TEST_MODE;
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.CHECKIN_USERNAME;
    delete process.env.CHECKIN_PASSWORD_HASH;
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

  describe('forgotPassword', () => {
    /** The email is sent without being awaited — let that promise settle. */
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'me@gmail.com',
      });
    });

    it('stores a 6-digit code bound to the account and emails that same code', async () => {
      await service.forgotPassword({ email: 'me@gmail.com' });
      await flush();

      const stored = JSON.parse(redisStore.get('password-reset:me@gmail.com')!);
      expect(stored.userId).toBe('user-1');
      expect(stored.code).toMatch(/^\d{6}$/);
      expect(emailService.sendPasswordResetCode).toHaveBeenCalledWith(
        'me@gmail.com',
        stored.code,
      );
    });

    it('gives an unregistered address the identical response and sends nothing (no email-enumeration oracle)', async () => {
      const registered = await service.forgotPassword({ email: 'me@gmail.com' });

      prisma.user.findUnique.mockResolvedValue(null);
      const unknown = await service.forgotPassword({ email: 'nobody@gmail.com' });
      await flush();

      expect(unknown).toEqual(registered);
      expect(emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
      expect(redisStore.has('password-reset:nobody@gmail.com')).toBe(false);
    });

    it('drops a second request inside the cooldown instead of emailing again', async () => {
      await service.forgotPassword({ email: 'me@gmail.com' });
      const firstCode = JSON.parse(redisStore.get('password-reset:me@gmail.com')!).code;

      const second = await service.forgotPassword({ email: 'me@gmail.com' });
      await flush();

      expect(second).toEqual({
        message: 'If that email is registered, a reset code has been sent',
      });
      expect(emailService.sendPasswordResetCode).toHaveBeenCalledTimes(1);
      // The code the user already received must still be the valid one.
      expect(JSON.parse(redisStore.get('password-reset:me@gmail.com')!).code).toBe(firstCode);
    });

    it('does not surface a mail-provider failure, which would reveal the address is registered', async () => {
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      emailService.sendPasswordResetCode.mockRejectedValue(new Error('resend down'));

      await expect(
        service.forgotPassword({ email: 'me@gmail.com' }),
      ).resolves.toEqual({
        message: 'If that email is registered, a reset code has been sent',
      });
      await flush();

      expect(logged).toHaveBeenCalled();
      logged.mockRestore();
    });
  });

  describe('resetPassword', () => {
    async function seedReset(email: string, code: string, userId = 'user-1') {
      await redis.set(
        `password-reset:${email.toLowerCase()}`,
        JSON.stringify({ code, userId }),
      );
    }

    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    });

    it('sets the new password (hashed) with the correct code, lifts any login lockout, and spends the code', async () => {
      await seedReset('me@gmail.com', '123456');
      await redis.set('login-attempts:me@gmail.com', '5');

      const result = await service.resetPassword({
        email: 'me@gmail.com',
        code: '123456',
        newPassword: 'brand-new-pass',
      });

      expect(result).toEqual({ message: 'Password has been reset' });
      const { where, data } = prisma.user.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'user-1' });
      expect(data.passwordHash).not.toBe('brand-new-pass');
      expect(await bcrypt.compare('brand-new-pass', data.passwordHash)).toBe(true);
      expect(redisStore.has('password-reset:me@gmail.com')).toBe(false);
      expect(redisStore.has('login-attempts:me@gmail.com')).toBe(false);

      // Single use: replaying the same code afterwards is refused.
      await expect(
        service.resetPassword({
          email: 'me@gmail.com',
          code: '123456',
          newPassword: 'another-pass-1',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).toHaveBeenCalledTimes(1);
    });

    it('rejects a wrong code without touching the password', async () => {
      await seedReset('me@gmail.com', '123456');

      await expect(
        service.resetPassword({
          email: 'me@gmail.com',
          code: '000000',
          newPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow('Incorrect reset code');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('kills the code after MAX_RESET_ATTEMPTS wrong guesses, so even the right code no longer works', async () => {
      await seedReset('me@gmail.com', '123456');

      for (let i = 0; i < 4; i++) {
        await expect(
          service.resetPassword({
            email: 'me@gmail.com',
            code: '000000',
            newPassword: 'brand-new-pass',
          }),
        ).rejects.toThrow('Incorrect reset code');
      }
      await expect(
        service.resetPassword({
          email: 'me@gmail.com',
          code: '000000',
          newPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow('Too many incorrect attempts');

      await expect(
        service.resetPassword({
          email: 'me@gmail.com',
          code: '123456',
          newPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow('expired or not found');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects when no code was ever requested (or it expired)', async () => {
      await expect(
        service.resetPassword({
          email: 'me@gmail.com',
          code: '123456',
          newPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow('expired or not found');
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('rejects a code that was issued for a different account sharing the same lowercased key', async () => {
      // Code was issued for user-2 (e.g. "Me@gmail.com"), but the request
      // resolves to user-1 ("me@gmail.com") — must not reset user-1.
      await seedReset('me@gmail.com', '123456', 'user-2');

      await expect(
        service.resetPassword({
          email: 'me@gmail.com',
          code: '123456',
          newPassword: 'brand-new-pass',
        }),
      ).rejects.toThrow('expired or not found');
      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(redisStore.has('password-reset:me@gmail.com')).toBe(false);
    });
  });

  describe('checkinLogin', () => {
    const creds = { username: 'door', password: 'door-password', staffName: ' 小美 ' };

    beforeEach(async () => {
      process.env.CHECKIN_USERNAME = 'door';
      process.env.CHECKIN_PASSWORD_HASH = await bcrypt.hash('door-password', 4);
    });

    it('refuses outright when the check-in account is not configured', async () => {
      delete process.env.CHECKIN_PASSWORD_HASH;
      await expect(service.checkinLogin(creds, '1.1.1.1')).rejects.toThrow(
        'Check-in login is not configured',
      );
    });

    it('issues a CHECKIN-role token (never ADMIN) carrying the trimmed staff name, valid for the event day', async () => {
      await expect(service.checkinLogin(creds, '1.1.1.1')).resolves.toEqual({
        accessToken: 'signed-jwt',
      });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'checkin', email: 'door', role: 'CHECKIN', name: '小美' },
        { expiresIn: '12h' },
      );
    });

    it('rejects a wrong password or username', async () => {
      await expect(
        service.checkinLogin({ ...creds, password: 'nope' }, '1.1.1.1'),
      ).rejects.toThrow('Invalid credentials');
      await expect(
        service.checkinLogin({ ...creds, username: 'admin' }, '1.1.1.1'),
      ).rejects.toThrow('Invalid credentials');
    });

    it('locks out only the guessing IP — other scanners at the door can still log in', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          service.checkinLogin({ ...creds, password: 'nope' }, '6.6.6.6'),
        ).rejects.toThrow('Invalid credentials');
      }
      await expect(service.checkinLogin(creds, '6.6.6.6')).rejects.toThrow(
        'Too many failed login attempts',
      );
      await expect(service.checkinLogin(creds, '1.1.1.1')).resolves.toEqual({
        accessToken: 'signed-jwt',
      });
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
