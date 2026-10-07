import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ContactService, MAX_CONTACTS } from './contact.service';

describe('ContactService', () => {
  let prisma: any;
  let service: ContactService;

  beforeEach(() => {
    prisma = {
      contact: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'c1', ...data })),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'c1', ...data })),
        delete: jest.fn().mockResolvedValue(undefined),
      },
    };
    service = new ContactService(prisma);
  });

  it('lists in sortOrder then creation order, exposing only public fields', async () => {
    await service.list();
    expect(prisma.contact.findMany).toHaveBeenCalledWith({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, lineId: true, email: true, sortOrder: true },
    });
  });

  describe('create', () => {
    it('trims, stores blanks as null, and appends after the current last entry', async () => {
      prisma.contact.findFirst.mockResolvedValue({ sortOrder: 4 });
      await service.create({ name: ' 小美 ', lineId: ' @ts-help ', email: '  ' });
      expect(prisma.contact.create).toHaveBeenCalledWith({
        data: { name: '小美', lineId: '@ts-help', email: null, sortOrder: 5 },
      });
    });

    it('starts at 0 when the list is empty, and honours an explicit order', async () => {
      await service.create({ name: 'A', email: 'a@b.co' });
      expect(prisma.contact.create.mock.calls[0][0].data.sortOrder).toBe(0);
      await service.create({ name: 'B', email: 'b@b.co', sortOrder: 9 });
      expect(prisma.contact.create.mock.calls[1][0].data.sortOrder).toBe(9);
    });

    it('needs a name and at least one of LINE / email', async () => {
      await expect(service.create({ name: ' ', email: 'a@b.co' })).rejects.toThrow(BadRequestException);
      await expect(service.create({ name: 'A' })).rejects.toThrow('至少要填一個');
      await expect(service.create({ name: 'A', lineId: ' ', email: '' })).rejects.toThrow('至少要填一個');
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });

    it('refuses a bad email and any link scheme other than https', async () => {
      await expect(service.create({ name: 'A', email: 'not-an-email' })).rejects.toThrow('Email');
      for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://line.me/ti/p/x', 'JAVASCRIPT:1']) {
        await expect(service.create({ name: 'A', lineId: bad })).rejects.toThrow('https');
      }
      await expect(service.create({ name: 'A', lineId: 'https://line.me/ti/p/abc' })).resolves.toBeDefined();
      await expect(service.create({ name: 'A', lineId: 'ts_help.01' })).resolves.toBeDefined();
    });

    it('stops at the cap', async () => {
      prisma.contact.count.mockResolvedValue(MAX_CONTACTS);
      await expect(service.create({ name: 'A', email: 'a@b.co' })).rejects.toThrow(BadRequestException);
      expect(prisma.contact.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const existing = { id: 'c1', name: '小美', lineId: '@old', email: null, sortOrder: 1 };

    it('changes only what was sent', async () => {
      prisma.contact.findUnique.mockResolvedValue(existing);
      await service.update('c1', { email: 'new@b.co' });
      expect(prisma.contact.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { name: '小美', lineId: '@old', email: 'new@b.co' },
      });
    });

    it('an empty string clears a field, but not the last remaining one', async () => {
      prisma.contact.findUnique.mockResolvedValue({ ...existing, email: 'a@b.co' });
      await service.update('c1', { lineId: '' });
      expect(prisma.contact.update.mock.calls[0][0].data.lineId).toBeNull();

      prisma.contact.findUnique.mockResolvedValue(existing);
      await expect(service.update('c1', { lineId: '' })).rejects.toThrow('至少要填一個');
    });

    it('re-checks the link scheme on update, and 404s an unknown id', async () => {
      prisma.contact.findUnique.mockResolvedValue(existing);
      await expect(service.update('c1', { lineId: 'javascript:1' })).rejects.toThrow('https');
      prisma.contact.findUnique.mockResolvedValue(null);
      await expect(service.update('x', { name: 'A' })).rejects.toThrow(NotFoundException);
    });

    it('updates the sort order without touching the rest', async () => {
      prisma.contact.findUnique.mockResolvedValue(existing);
      await service.update('c1', { sortOrder: 7 });
      expect(prisma.contact.update.mock.calls[0][0].data.sortOrder).toBe(7);
    });
  });

  it('remove deletes, and 404s an unknown id', async () => {
    prisma.contact.findUnique.mockResolvedValue({ id: 'c1' });
    await expect(service.remove('c1')).resolves.toEqual({ deleted: true });
    expect(prisma.contact.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    prisma.contact.findUnique.mockResolvedValue(null);
    await expect(service.remove('x')).rejects.toThrow(NotFoundException);
  });
});
