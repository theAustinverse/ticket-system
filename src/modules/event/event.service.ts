import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateSaleBatchDto } from './dto/create-sale-batch.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';
import { UpdateSaleBatchDto } from './dto/update-sale-batch.dto';

@Injectable()
export class EventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
  ) {}

  createEvent(dto: CreateEventDto) {
    return this.prisma.event.create({ data: dto });
  }

  findAllEvents() {
    return this.prisma.event.findMany({ include: { sessions: true } });
  }

  async findEvent(id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        sessions: {
          include: {
            batches: {
              // createdAt alone doesn't disambiguate batches bulk-inserted in
              // the same millisecond — id is a secondary sort key (cuids are
              // chronologically sortable) so wave order stays stable either way.
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: {
                ticketTypes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
              },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);

    for (const session of event.sessions) {
      for (const batch of session.batches) {
        for (const ticketType of batch.ticketTypes as any[]) {
          ticketType.remainingStock = await this.remainingStockFor(ticketType);
        }
      }
    }

    return event;
  }

  /**
   * For a shared-pool group ticket type, the number of bundles it can still
   * sell is capped by whichever is smaller: the shared pool's remaining
   * seats, or the remaining group-order allowance times its bundle size —
   * exceeding either would either oversell the pool or the group cap.
   */
  private async remainingStockFor(ticketType: {
    id: string;
    fixedQuantity: number | null;
    sharedStockKey: string | null;
    maxGroupOrders: number | null;
  }): Promise<number | null> {
    const stockKey = ticketType.sharedStockKey ?? ticketType.id;
    const poolRemaining = await this.inventory.getStock(stockKey);
    if (poolRemaining === null) return null;

    if (ticketType.fixedQuantity !== null && ticketType.maxGroupOrders !== null) {
      const groupsSold = await this.inventory.getGroupOrderCount(ticketType.id);
      const groupsLeft = Math.max(0, ticketType.maxGroupOrders - groupsSold);
      return Math.min(poolRemaining, groupsLeft * ticketType.fixedQuantity);
    }

    return poolRemaining;
  }

  async createSession(eventId: string, dto: CreateSessionDto) {
    await this.findEvent(eventId);
    return this.prisma.session.create({
      data: {
        eventId,
        venue: dto.venue,
        startTime: new Date(dto.startTime),
        mapUrl: dto.mapUrl,
      },
    });
  }

  private async findSession(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    return session;
  }

  async createBatch(sessionId: string, dto: CreateSaleBatchDto) {
    await this.findSession(sessionId);
    return this.prisma.saleBatch.create({
      data: {
        sessionId,
        name: dto.name,
        saleStartAt: dto.saleStartAt ? new Date(dto.saleStartAt) : null,
      },
    });
  }

  async findBatch(batchId: string) {
    const batch = await this.prisma.saleBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) throw new NotFoundException(`Batch ${batchId} not found`);
    return batch;
  }

  /**
   * Admin-only: (re)announce or lock a wave's open time. Omitting
   * saleStartAt leaves it untouched; passing null locks the wave back to
   * "TBD" (assertOnSale then rejects every order for its ticket types).
   */
  async updateBatch(batchId: string, dto: UpdateSaleBatchDto) {
    await this.findBatch(batchId);
    const data: {
      saleStartAt?: Date | null;
      saleEndAt?: Date | null;
      stockSweepDone?: boolean;
    } = {};
    if (dto.saleStartAt !== undefined) {
      data.saleStartAt = dto.saleStartAt === null ? null : new Date(dto.saleStartAt);
    }
    if (dto.saleEndAt !== undefined) {
      data.saleEndAt = dto.saleEndAt === null ? null : new Date(dto.saleEndAt);
    }
    if (dto.stockSweepDone !== undefined) {
      data.stockSweepDone = dto.stockSweepDone;
    }
    return this.prisma.saleBatch.update({ where: { id: batchId }, data });
  }

  /**
   * Creates the ticket type and seeds its sellable stock in Redis. When
   * sharedStockKey is set, the pool is only initialized if it doesn't
   * already exist (SETNX) — so creating the second ticket type of a shared
   * pair doesn't stomp on whatever the first one already sold.
   */
  async createTicketType(batchId: string, dto: CreateTicketTypeDto) {
    const batch = await this.findBatch(batchId);
    const ticketType = await this.prisma.ticketType.create({
      data: { sessionId: batch.sessionId, batchId, ...dto },
    });
    if (ticketType.sharedStockKey) {
      await this.inventory.initStockIfAbsent(
        ticketType.sharedStockKey,
        ticketType.poolTotalQuantity ?? ticketType.totalQuantity,
      );
    } else {
      await this.inventory.initStock(ticketType.id, ticketType.totalQuantity);
    }
    return ticketType;
  }

  /**
   * Admin-only partial update — used to migrate an existing ticket type onto
   * a shared stock pool / group cap / passcode gate after the fact, or to
   * correct its capacity (e.g. undoing a stock-sweep amount the admin didn't
   * want). Does not touch Redis; call AdminService.resetStock afterwards to
   * resync stock from real Postgres order data — safe to do any time since
   * it derives the new Redis count from totalQuantity minus actual PAID
   * orders rather than blindly overwriting it.
   */
  async updateTicketType(id: string, dto: UpdateTicketTypeDto) {
    await this.findTicketType(id);
    return this.prisma.ticketType.update({ where: { id }, data: dto });
  }

  async findTicketType(id: string) {
    const ticketType = await this.prisma.ticketType.findUnique({
      where: { id },
      include: { batch: true },
    });
    if (!ticketType)
      throw new NotFoundException(`Ticket type ${id} not found`);
    return ticketType;
  }

  /**
   * Throws if the ticket type's sale batch hasn't opened yet (including
   * batches whose start time is still TBD, represented as a null saleStartAt)
   * or has already closed (saleEndAt reached — its leftover stock has moved
   * on to the next wave by then, see StockSweepService).
   */
  async assertOnSale(ticketTypeId: string): Promise<void> {
    const ticketType = await this.findTicketType(ticketTypeId);
    const { saleStartAt, saleEndAt } = ticketType.batch;
    if (!saleStartAt || saleStartAt.getTime() > Date.now()) {
      throw new SaleNotOpenError(ticketTypeId);
    }
    if (saleEndAt && saleEndAt.getTime() <= Date.now()) {
      throw new SaleNotOpenError(ticketTypeId);
    }
  }
}

export class SaleNotOpenError extends Error {
  constructor(ticketTypeId: string) {
    super(`Sales for ticket type ${ticketTypeId} have not opened yet`);
  }
}
