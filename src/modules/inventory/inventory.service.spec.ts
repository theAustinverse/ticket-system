import {
  GroupOrderCapReachedError,
  InsufficientStockError,
  InventoryService,
  StockNotInitializedError,
} from './inventory.service';

describe('InventoryService', () => {
  const scriptSha = 'fake-sha';
  let evalsha: jest.Mock;
  let redisMock: any;
  let service: InventoryService;

  beforeEach(async () => {
    evalsha = jest.fn();
    redisMock = {
      script: jest.fn().mockResolvedValue(scriptSha),
      evalsha,
      set: jest.fn(),
      setnx: jest.fn(),
      get: jest.fn(),
      incrby: jest.fn(),
      decr: jest.fn(),
    };
    service = new InventoryService(redisMock);
    await service.onModuleInit();
  });

  it('returns remaining stock on successful decrement', async () => {
    evalsha.mockResolvedValue(4);
    const remaining = await service.decrementStock('tt1', 1);
    expect(remaining).toBe(4);
    expect(evalsha).toHaveBeenCalledWith(scriptSha, 1, 'stock:tt1', 1);
  });

  it('throws InsufficientStockError when script returns -1', async () => {
    evalsha.mockResolvedValue(-1);
    await expect(service.decrementStock('tt1', 5)).rejects.toThrow(
      InsufficientStockError,
    );
  });

  it('throws StockNotInitializedError when script returns -2', async () => {
    evalsha.mockResolvedValue(-2);
    await expect(service.decrementStock('tt1', 1)).rejects.toThrow(
      StockNotInitializedError,
    );
  });

  it('initStock sets the stock key to the given quantity', async () => {
    await service.initStock('tt1', 100);
    expect(redisMock.set).toHaveBeenCalledWith('stock:tt1', 100);
  });

  it('releaseStock increments the stock key', async () => {
    await service.releaseStock('tt1', 2);
    expect(redisMock.incrby).toHaveBeenCalledWith('stock:tt1', 2);
  });

  it('initStockIfAbsent uses SETNX', async () => {
    await service.initStockIfAbsent('pool1', 250);
    expect(redisMock.setnx).toHaveBeenCalledWith('stock:pool1', 250);
  });

  describe('NOSCRIPT recovery', () => {
    // Reproduces the production incident: Redis restarts independently of
    // this container, wiping its in-memory script cache, so the SHA cached
    // at boot no longer matches anything Redis has — every EVALSHA using it
    // fails with this exact error until something reloads the script.
    const noscriptError = () =>
      Object.assign(new Error('NOSCRIPT No matching script. Please use EVAL.'), {
        name: 'ReplyError',
      });

    it('reloads the script and retries once on NOSCRIPT, then succeeds', async () => {
      evalsha.mockRejectedValueOnce(noscriptError()).mockResolvedValueOnce(7);

      const remaining = await service.decrementStock('tt1', 1);

      expect(remaining).toBe(7);
      expect(evalsha).toHaveBeenCalledTimes(2);
      // Second call must use whatever SHA the reload actually returned, not
      // silently reuse the stale one that just failed.
      expect(redisMock.script).toHaveBeenCalledWith('LOAD', expect.any(String));
    });

    it('does the same reload-and-retry for decrementGroupStock', async () => {
      evalsha.mockRejectedValueOnce(noscriptError()).mockResolvedValueOnce(9);

      const remaining = await service.decrementGroupStock('pool1', 'tt-group', 11, 20);

      expect(remaining).toBe(9);
      expect(evalsha).toHaveBeenCalledTimes(2);
    });

    it('propagates a non-NOSCRIPT error without retrying', async () => {
      evalsha.mockRejectedValue(new Error('READONLY You can\'t write against a read only replica.'));

      await expect(service.decrementStock('tt1', 1)).rejects.toThrow('READONLY');
      expect(evalsha).toHaveBeenCalledTimes(1);
    });

    it('propagates the error if the retry after reload also fails', async () => {
      evalsha.mockRejectedValue(noscriptError());

      await expect(service.decrementStock('tt1', 1)).rejects.toThrow('NOSCRIPT');
      expect(evalsha).toHaveBeenCalledTimes(2);
    });
  });

  describe('decrementGroupStock', () => {
    it('returns remaining stock and passes both keys plus args to the script', async () => {
      evalsha.mockResolvedValue(139);
      const remaining = await service.decrementGroupStock('pool1', 'tt-group', 11, 20);
      expect(remaining).toBe(139);
      expect(evalsha).toHaveBeenCalledWith(
        scriptSha,
        2,
        'stock:pool1',
        'groupcount:tt-group',
        11,
        20,
      );
    });

    it('throws GroupOrderCapReachedError when script returns -3', async () => {
      evalsha.mockResolvedValue(-3);
      await expect(
        service.decrementGroupStock('pool1', 'tt-group', 11, 20),
      ).rejects.toThrow(GroupOrderCapReachedError);
    });

    it('throws InsufficientStockError when script returns -1', async () => {
      evalsha.mockResolvedValue(-1);
      await expect(
        service.decrementGroupStock('pool1', 'tt-group', 11, 20),
      ).rejects.toThrow(InsufficientStockError);
    });

    it('throws StockNotInitializedError when script returns -2', async () => {
      evalsha.mockResolvedValue(-2);
      await expect(
        service.decrementGroupStock('pool1', 'tt-group', 11, 20),
      ).rejects.toThrow(StockNotInitializedError);
    });
  });

  it('releaseGroupStock increments the pool and decrements the group counter', async () => {
    await service.releaseGroupStock('pool1', 'tt-group', 11);
    expect(redisMock.incrby).toHaveBeenCalledWith('stock:pool1', 11);
    expect(redisMock.decr).toHaveBeenCalledWith('groupcount:tt-group');
  });
});
