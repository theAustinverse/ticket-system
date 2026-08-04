import { QueueRoomService } from './queue-room.service';

/**
 * GROUP_TICKET_PASSCODE is read once at module load, so each case has to set
 * the env var and re-require the module rather than mutating it afterwards.
 *
 * Note the assertions below match on message rather than on
 * ForbiddenException: jest.resetModules() re-instantiates @nestjs/common too,
 * so the thrown class is a different identity from one imported up here and a
 * constructor match would fail even when the behaviour is correct.
 */
function loadService(passcode: string | undefined, deps: { redis: any; prisma: any }) {
  jest.resetModules();
  if (passcode === undefined) delete process.env.GROUP_TICKET_PASSCODE;
  else process.env.GROUP_TICKET_PASSCODE = passcode;
  const {
    QueueRoomService: Loaded,
  } = require('./queue-room.service') as {
    QueueRoomService: typeof QueueRoomService;
  };
  return new Loaded(deps.redis, deps.prisma);
}

describe('QueueRoomService passcode gate', () => {
  const originalPasscode = process.env.GROUP_TICKET_PASSCODE;
  let redis: any;
  let prisma: any;

  const completeProfile = {
    name: 'Someone',
    team: 'Team',
    lineId: 'line',
    phone: '0900000000',
  };

  beforeEach(() => {
    redis = {
      zadd: jest.fn().mockResolvedValue(1),
      set: jest.fn().mockResolvedValue('OK'),
    };
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(completeProfile) },
      ticketType: {
        findUnique: jest.fn().mockResolvedValue({ requiresPasscode: true }),
      },
    };
  });

  afterAll(() => {
    if (originalPasscode === undefined) delete process.env.GROUP_TICKET_PASSCODE;
    else process.env.GROUP_TICKET_PASSCODE = originalPasscode;
  });

  it('admits a caller supplying the configured passcode', async () => {
    const service = loadService('a-configured-passcode', { redis, prisma });
    const token = await service.enter('tt-group', 'user-1', 'a-configured-passcode');
    expect(typeof token).toBe('string');
    expect(redis.zadd).toHaveBeenCalled();
  });

  it('rejects a caller supplying the wrong passcode', async () => {
    const service = loadService('a-configured-passcode', { redis, prisma });
    await expect(service.enter('tt-group', 'user-1', 'wrong')).rejects.toThrow(
      'Incorrect passcode',
    );
    expect(redis.zadd).not.toHaveBeenCalled();
  });

  it('fails closed when no passcode is configured — never treats unset as an open gate', async () => {
    const service = loadService(undefined, { redis, prisma });
    // Both an empty attempt and a guess at the old hardcoded default must be
    // refused: unset means misconfigured, not ungated.
    await expect(service.enter('tt-group', 'user-1', undefined)).rejects.toThrow(
      '系統尚未設定通關密碼',
    );
    await expect(service.enter('tt-group', 'user-1', '142857')).rejects.toThrow(
      '系統尚未設定通關密碼',
    );
    expect(redis.zadd).not.toHaveBeenCalled();
  });

  it('leaves ticket types that do not require a passcode unaffected when it is unset', async () => {
    prisma.ticketType.findUnique.mockResolvedValue({ requiresPasscode: false });
    const service = loadService(undefined, { redis, prisma });
    const token = await service.enter('tt-individual', 'user-1');
    expect(typeof token).toBe('string');
    expect(redis.zadd).toHaveBeenCalled();
  });

  it('still requires a completed profile before the passcode is even considered', async () => {
    prisma.user.findUnique.mockResolvedValue({ ...completeProfile, phone: null });
    const service = loadService('a-configured-passcode', { redis, prisma });
    await expect(
      service.enter('tt-group', 'user-1', 'a-configured-passcode'),
    ).rejects.toThrow('請先至「設定」頁面完成個人資料填寫');
    expect(redis.zadd).not.toHaveBeenCalled();
  });
});
