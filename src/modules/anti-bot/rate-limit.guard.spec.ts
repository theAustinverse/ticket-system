import { HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

describe('RateLimitGuard', () => {
  const scriptSha = 'fake-sha';
  let evalsha: jest.Mock;
  let redisMock: any;
  let reflector: any;
  let guard: RateLimitGuard;
  const originalLoadTestMode = process.env.LOAD_TEST_MODE;

  function makeContext() {
    return {
      getHandler: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          ip: '1.2.3.4',
          method: 'POST',
          url: '/auth/admin-login',
          route: { path: '/auth/admin-login' },
        }),
      }),
    } as any;
  }

  beforeEach(async () => {
    delete process.env.LOAD_TEST_MODE;
    evalsha = jest.fn();
    redisMock = {
      script: jest.fn().mockResolvedValue(scriptSha),
      evalsha,
    };
    reflector = { get: jest.fn().mockReturnValue({ limit: 5, windowSeconds: 60 }) };
    guard = new RateLimitGuard(redisMock, reflector);
    await guard.onModuleInit();
  });

  afterAll(() => {
    if (originalLoadTestMode === undefined) delete process.env.LOAD_TEST_MODE;
    else process.env.LOAD_TEST_MODE = originalLoadTestMode;
  });

  it('allows the request when under the limit', async () => {
    evalsha.mockResolvedValue(3);
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('throws 429 once the count exceeds the limit', async () => {
    evalsha.mockResolvedValue(6);
    await expect(guard.canActivate(makeContext())).rejects.toThrow(HttpException);
  });

  it('bypasses Redis entirely under LOAD_TEST_MODE', async () => {
    process.env.LOAD_TEST_MODE = 'true';
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
    expect(evalsha).not.toHaveBeenCalled();
  });

  describe('NOSCRIPT recovery', () => {
    // Reproduces the production incident this guard actually hit: admin
    // login returned a 500 because Redis restarted independently of the api
    // container, wiping its in-memory script cache — the SHA cached at boot
    // no longer matched anything Redis had, and EVALSHA failed outright.
    const noscriptError = () =>
      Object.assign(new Error('NOSCRIPT No matching script. Please use EVAL.'), {
        name: 'ReplyError',
      });

    it('reloads the script and retries once instead of surfacing a 500', async () => {
      evalsha.mockRejectedValueOnce(noscriptError()).mockResolvedValueOnce(1);

      await expect(guard.canActivate(makeContext())).resolves.toBe(true);
      expect(evalsha).toHaveBeenCalledTimes(2);
    });

    it('propagates the error if the retry after reload also fails', async () => {
      evalsha.mockRejectedValue(noscriptError());

      await expect(guard.canActivate(makeContext())).rejects.toThrow('NOSCRIPT');
      expect(evalsha).toHaveBeenCalledTimes(2);
    });

    it('propagates a non-NOSCRIPT Redis error without retrying', async () => {
      evalsha.mockRejectedValue(new Error('Connection is closed.'));

      await expect(guard.canActivate(makeContext())).rejects.toThrow('Connection is closed');
      expect(evalsha).toHaveBeenCalledTimes(1);
    });
  });
});
