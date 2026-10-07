import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const MAX_CONTACTS = 30;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ContactInput {
  name?: string;
  lineId?: string;
  email?: string;
  sortOrder?: number;
}

/** Blank → null, so "clear this field" and "never set" look the same. */
function clean(value: string | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The LINE field is shown to every visitor and rendered as a link when it
 * looks like one, so a scheme other than https (javascript:, data:, http:)
 * is refused here rather than trusted to the frontend alone.
 */
function assertSafeLine(lineId: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(lineId) && !/^https:\/\//i.test(lineId)) {
    throw new BadRequestException('LINE 欄位只能填 LINE ID，或 https:// 開頭的連結');
  }
}

@Injectable()
export class ContactService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public and admin share one list: there is nothing in a contact an admin may see that a visitor may not. */
  list() {
    return this.prisma.contact.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        lineId: true,
        email: true,
        sortOrder: true,
      },
    });
  }

  async create(input: ContactInput) {
    const name = input.name?.trim() ?? '';
    const lineId = clean(input.lineId) ?? null;
    const email = clean(input.email) ?? null;
    if (!name) throw new BadRequestException('請填寫姓名或稱呼');
    if (!lineId && !email) {
      throw new BadRequestException('LINE 和 Email 至少要填一個');
    }
    if (lineId) assertSafeLine(lineId);
    if (email && !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('Email 格式不正確');
    }
    if ((await this.prisma.contact.count()) >= MAX_CONTACTS) {
      throw new BadRequestException(`聯絡窗口最多 ${MAX_CONTACTS} 位`);
    }

    // New entries go to the end unless an order is given.
    let sortOrder = input.sortOrder;
    if (sortOrder === undefined) {
      const last = await this.prisma.contact.findFirst({
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      sortOrder = (last?.sortOrder ?? -1) + 1;
    }

    return this.prisma.contact.create({
      data: { name, lineId, email, sortOrder },
    });
  }

  async update(id: string, input: ContactInput) {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Contact ${id} not found`);

    const name = input.name === undefined ? existing.name : input.name.trim();
    const lineId =
      input.lineId === undefined ? existing.lineId : (clean(input.lineId) ?? null);
    const email = input.email === undefined ? existing.email : (clean(input.email) ?? null);
    if (!name) throw new BadRequestException('請填寫姓名或稱呼');
    if (!lineId && !email) {
      throw new BadRequestException('LINE 和 Email 至少要填一個');
    }
    if (lineId) assertSafeLine(lineId);
    if (email && !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException('Email 格式不正確');
    }

    return this.prisma.contact.update({
      where: { id },
      data: {
        name,
        lineId,
        email,
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
      },
    });
  }

  async remove(id: string) {
    const existing = await this.prisma.contact.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException(`Contact ${id} not found`);
    await this.prisma.contact.delete({ where: { id } });
    return { deleted: true };
  }
}
