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
