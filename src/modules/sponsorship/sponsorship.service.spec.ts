import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SponsorshipService } from './sponsorship.service';

describe('SponsorshipService', () => {
  let prisma: any;
  let service: SponsorshipService;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'u1', email: 'a@b.c', name: '小明' }),
      },
      sponsorship: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 's1',
          status: 'PENDING',
          createdAt: new Date(),
          ...data,
        })),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    service = new SponsorshipService(prisma);
  });

  describe('create', () => {
    it('stores a PENDING pledge with a donor snapshot and a 6-digit code', async () => {
      const res = await service.create('u1', 100);

      expect(prisma.sponsorship.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          donorName: '小明',
          donorEmail: 'a@b.c',
          amount: 100,
          referenceCode: expect.stringMatching(/^\d{6}$/),
        }),
      });
      expect(res.status).toBe('PENDING');
      expect(res.amount).toBe(100);
    });

    it('falls back to the email when the profile has no name', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1', email: 'a@b.c', name: null });
      await service.create('u1', 50);
      expect(prisma.sponsorship.create.mock.calls[0][0].data.donorName).toBe('a@b.c');
    });

    it('refuses a sixth open pledge', async () => {
      prisma.sponsorship.count.mockResolvedValue(5);
      await expect(service.create('u1', 50)).rejects.toThrow(BadRequestException);
      expect(prisma.sponsorship.create).not.toHaveBeenCalled();
    });

    it('retries when the reference code collides', async () => {
      prisma.sponsorship.create
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockImplementationOnce(async ({ data }: any) => ({
          id: 's1',
          status: 'PENDING',
          createdAt: new Date(),
          ...data,
        }));
      const res = await service.create('u1', 500);
      expect(prisma.sponsorship.create).toHaveBeenCalledTimes(2);
      expect(res.amount).toBe(500);
    });

    it('does not swallow other database errors', async () => {
      prisma.sponsorship.create.mockRejectedValue(new Error('db down'));
      await expect(service.create('u1', 50)).rejects.toThrow('db down');
    });
  });

  describe('report', () => {
    const row = { id: 's1', userId: 'u1', amount: 100, referenceCode: '123456', status: 'PENDING', createdAt: new Date(), reportedAt: null };

    it("stamps reportedAt when the typed code matches, scoped to the caller's own pledge", async () => {
      prisma.sponsorship.findFirst.mockResolvedValue(row);
      prisma.sponsorship.update.mockResolvedValue({ ...row, reportedAt: new Date() });

      const res = await service.report('u1', 's1', '123456');

      expect(prisma.sponsorship.findFirst).toHaveBeenCalledWith({ where: { id: 's1', userId: 'u1' } });
      expect(prisma.sponsorship.update.mock.calls[0][0].data.reportedAt).toBeInstanceOf(Date);
      expect(res.reportedAt).toBeInstanceOf(Date);
    });

    it('refuses a wrong code and writes nothing', async () => {
      prisma.sponsorship.findFirst.mockResolvedValue(row);
      await expect(service.report('u1', 's1', '000000')).rejects.toThrow(BadRequestException);
      expect(prisma.sponsorship.update).not.toHaveBeenCalled();
    });

    it("404s on someone else's pledge", async () => {
      prisma.sponsorship.findFirst.mockResolvedValue(null);
      await expect(service.report('u2', 's1', '123456')).rejects.toThrow(NotFoundException);
    });

    it('refuses a pledge that is no longer PENDING', async () => {
      prisma.sponsorship.findFirst.mockResolvedValue({ ...row, status: 'RECEIVED' });
      await expect(service.report('u1', 's1', '123456')).rejects.toThrow(BadRequestException);
    });

    it('is idempotent: a repeat report keeps the first timestamp', async () => {
      const first = new Date('2026-10-01');
      prisma.sponsorship.findFirst.mockResolvedValue({ ...row, reportedAt: first });
      const res = await service.report('u1', 's1', '123456');
      expect(prisma.sponsorship.update).not.toHaveBeenCalled();
      expect(res.reportedAt).toBe(first);
    });
  });

  describe('updateStatus', () => {
    it('stamps confirmedAt when marking RECEIVED and clears it otherwise', async () => {
      prisma.sponsorship.findUnique.mockResolvedValue({ id: 's1' });
      prisma.sponsorship.update.mockResolvedValue({});

      await service.updateStatus('s1', 'RECEIVED');
      expect(prisma.sponsorship.update.mock.calls[0][0].data.confirmedAt).toBeInstanceOf(Date);

      await service.updateStatus('s1', 'PENDING');
      expect(prisma.sponsorship.update.mock.calls[1][0].data.confirmedAt).toBeNull();
    });

    it('throws NotFoundException for a missing row', async () => {
      prisma.sponsorship.findUnique.mockResolvedValue(null);
      await expect(service.updateStatus('x', 'RECEIVED')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes an existing row', async () => {
      prisma.sponsorship.findUnique.mockResolvedValue({ id: 's1' });
      expect(await service.remove('s1')).toEqual({ deleted: true });
      expect(prisma.sponsorship.delete).toHaveBeenCalledWith({ where: { id: 's1' } });
    });

    it('throws NotFoundException for a missing row and deletes nothing', async () => {
      prisma.sponsorship.findUnique.mockResolvedValue(null);
      await expect(service.remove('x')).rejects.toThrow(NotFoundException);
      expect(prisma.sponsorship.delete).not.toHaveBeenCalled();
    });
  });

  describe('listAll', () => {
    it('totals only RECEIVED as money in; PENDING is shown separately', async () => {
      prisma.sponsorship.findMany.mockResolvedValue([
        { amount: 100, status: 'RECEIVED' },
        { amount: 500, status: 'RECEIVED' },
        { amount: 50, status: 'PENDING' },
        { amount: 999, status: 'CANCELLED' },
      ]);
      const { totals } = await service.listAll();
      expect(totals).toEqual({ received: 600, pending: 50, receivedCount: 2, pendingCount: 1 });
    });
  });

  describe('getInfo', () => {
    afterEach(() => delete process.env.SPONSOR_PAYMENT_INFO);
    it('exposes the three presets and null payment info when unset', () => {
      delete process.env.SPONSOR_PAYMENT_INFO;
      expect(service.getInfo()).toMatchObject({ presets: [50, 100, 500], paymentInfo: null });
    });
    it('returns the configured payment info', () => {
      process.env.SPONSOR_PAYMENT_INFO = ' 銀行 123 ';
      expect(service.getInfo().paymentInfo).toBe('銀行 123');
    });
  });
});
