import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BSC_ADDRESS_RE,
  MAX_PENDING_PER_USER,
  SPONSOR_MAX_AMOUNT,
  SPONSOR_CRYPTO,
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
      crypto: this.cryptoInfo(),
    };
  }

  /** The crypto channel, or null while no (well-formed) address is set. */
  private cryptoInfo() {
    const { coin, network, address, memo } = SPONSOR_CRYPTO;
    if (!address || !BSC_ADDRESS_RE.test(address)) return null;
    return { coin, network, address, memo };
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

  /**
   * The sponsor says they've transferred and quoted the code. Requiring the
   * code to be typed back is what makes them read it before they go to the
   * bank app; it's checked against the pledge so a wrong code is refused.
   * A crypto payment can't carry the code in a memo, so it also sends the
   * transaction hash (lower-cased; unique, so one transfer can't back two
   * pledges). Idempotent: a second report keeps the first timestamp and a
   * hash, once recorded, can't be swapped for another.
   */
  async report(userId: string, id: string, referenceCode: string, txHash?: string) {
    const row = await this.prisma.sponsorship.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Sponsorship not found');
    if (row.referenceCode !== referenceCode) {
      throw new BadRequestException('對帳碼不正確，請核對後重新輸入');
    }
    if (row.status !== 'PENDING') {
      throw new BadRequestException('這筆贊助已處理完成，不需要再回報');
    }
    const hash = txHash?.toLowerCase();
    if (hash && !this.cryptoInfo()) {
      throw new BadRequestException('目前未開放加密貨幣贊助');
    }
    if (hash && row.txHash && row.txHash !== hash) {
      throw new BadRequestException('這筆贊助已回報過另一組交易哈希，如需更正請聯絡行政組');
    }
    const data: { reportedAt?: Date; txHash?: string } = {};
    if (!row.reportedAt) data.reportedAt = new Date();
    if (hash && !row.txHash) data.txHash = hash;
    if (Object.keys(data).length === 0) return this.toMine(row);
    try {
      return this.toMine(await this.prisma.sponsorship.update({ where: { id }, data }));
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new BadRequestException('這組交易哈希已經被回報過，請確認是否貼錯');
      }
      throw err;
    }
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

  /** Hard delete. Unlike cancelling, this leaves no trace — the page warns before doing it to a RECEIVED row. */
  async remove(id: string) {
    const existing = await this.prisma.sponsorship.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Sponsorship not found');
    await this.prisma.sponsorship.delete({ where: { id } });
    return { deleted: true };
  }

  private toMine(r: {
    id: string;
    amount: number;
    referenceCode: string;
    status: string;
    createdAt: Date;
    reportedAt?: Date | null;
    txHash?: string | null;
  }) {
    return {
      id: r.id,
      amount: r.amount,
      referenceCode: r.referenceCode,
      status: r.status,
      createdAt: r.createdAt,
      reportedAt: r.reportedAt ?? null,
      txHash: r.txHash ?? null,
    };
  }
}
