import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateSaleBatchDto } from './dto/create-sale-batch.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';

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
          include: { batches: { include: { ticketTypes: true } } },
        },
      },
    });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  async createSession(eventId: string, dto: CreateSessionDto) {
    await this.findEvent(eventId);
    return this.prisma.session.create({
      data: {
        eventId,
        venue: dto.venue,
        startTime: new Date(dto.startTime),
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

  /** Creates the ticket type and seeds its sellable stock in Redis. */
  async createTicketType(batchId: string, dto: CreateTicketTypeDto) {
    const batch = await this.findBatch(batchId);
    const ticketType = await this.prisma.ticketType.create({
      data: { sessionId: batch.sessionId, batchId, ...dto },
    });
    await this.inventory.initStock(ticketType.id, ticketType.totalQuantity);
    return ticketType;
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
   * batches whose start time is still TBD, represented as a null saleStartAt).
   */
  async assertOnSale(ticketTypeId: string): Promise<void> {
    const ticketType = await this.findTicketType(ticketTypeId);
    const { saleStartAt } = ticketType.batch;
    if (!saleStartAt || saleStartAt.getTime() > Date.now()) {
      throw new SaleNotOpenError(ticketTypeId);
    }
  }
}

export class SaleNotOpenError extends Error {
  constructor(ticketTypeId: string) {
    super(`Sales for ticket type ${ticketTypeId} have not opened yet`);
  }
}
