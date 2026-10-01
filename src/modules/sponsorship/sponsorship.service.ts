import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  MAX_PENDING_PER_USER,
  SPONSOR_MAX_AMOUNT,
  SPONSOR_MIN_AMOUNT,
  SPONSOR_PRESETS,
} from './sponsorship.constants';

type Status = 'PENDING' | 'RECEIVED' | 'CANCELLED';

@Injectable()
export class SponsorshipService {
  constructor(private readonly prisma: PrismaService) {}

  /** Static page config. Payment instructions come from env so no bank details live in the repo. */
  getInfo() {
    return {
      presets: SPONSOR_PRESETS,
      minAmount: SPONSOR_MIN_AMOUNT,
      maxAmount: SPONSOR_MAX_AMOUNT,
      paymentInfo:
        process.env.SPONSOR_PAYMENT_INFO?.replace(/\\n/g, '\n').trim() || null,
    };
  }

  async create(userId: string, amount: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const open = await this.prisma.sponsorship.count({
      where: { userId, status: 'PENDING' },
    });
    if (open >= MAX_PENDING_PER_USER) {
      throw new BadRequestException(
        `您已有 ${MAX_PENDING_PER_USER} 筆尚未完成的贊助，請先完成轉帳或等行政組核對後再新增`,
      );
    }

    // Collisions on a 6-digit code are rare but possible; the unique index is
    // the real guard, so retry on it rather than check-then-insert.
    for (let attempt = 0; attempt < 5; attempt++) {
      const referenceCode = String(randomInt(0, 1_000_000)).padStart(6, '0');
      try {
        const row = await this.prisma.sponsorship.create({
          data: {
            userId,
            donorName: user.name || user.email,
            donorEmail: user.email,
            amount,
            referenceCode,
          },
        });
        return { ...this.toMine(row), paymentInfo: this.getInfo().paymentInfo };
      } catch (err: any) {
        if (err?.code !== 'P2002') throw err;
      }
    }
    throw new BadRequestException('系統忙碌中，請稍後再試一次');
  }

  async listMine(userId: string) {
    const rows = await this.prisma.sponsorship.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toMine(r));
  }

  async listAll() {
    const rows = await this.prisma.sponsorship.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const sum = (s: Status) =>
      rows.filter((r) => r.status === s).reduce((n, r) => n + r.amount, 0);
    return {
      totals: {
        received: sum('RECEIVED'),
        pending: sum('PENDING'),
        receivedCount: rows.filter((r) => r.status === 'RECEIVED').length,
        pendingCount: rows.filter((r) => r.status === 'PENDING').length,
      },
      sponsorships: rows,
    };
  }

  async updateStatus(id: string, status: Status) {
    const existing = await this.prisma.sponsorship.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sponsorship not found');
    return this.prisma.sponsorship.update({
      where: { id },
      data: {
        status,
        confirmedAt: status === 'RECEIVED' ? new Date() : null,
      },
    });
  }

  private toMine(r: {
    id: string;
    amount: number;
    referenceCode: string;
    status: string;
    createdAt: Date;
  }) {
    return {
      id: r.id,
      amount: r.amount,
      referenceCode: r.referenceCode,
      status: r.status,
      createdAt: r.createdAt,
    };
  }
}
