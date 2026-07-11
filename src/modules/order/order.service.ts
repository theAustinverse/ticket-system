import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InsufficientStockError,
  InventoryService,
  StockNotInitializedError,
} from '../inventory/inventory.service';
import { EventService, SaleNotOpenError } from '../event/event.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ORDER_EXPIRY_MINUTES, ORDER_EXPIRY_QUEUE } from './order.constants';

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly eventService: EventService,
    @InjectQueue(ORDER_EXPIRY_QUEUE) private readonly expiryQueue: Queue,
  ) {}

  async createOrder(userId: string, dto: CreateOrderDto) {
    const ticketType = await this.eventService.findTicketType(
      dto.ticketTypeId,
    );

    try {
      await this.eventService.assertOnSale(dto.ticketTypeId);
    } catch (error) {
      if (error instanceof SaleNotOpenError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    if (
      ticketType.fixedQuantity !== null &&
      dto.quantity !== ticketType.fixedQuantity
    ) {
      throw new BadRequestException(
        `This ticket type must be purchased in bundles of ${ticketType.fixedQuantity}`,
      );
    }

    try {
      await this.inventory.decrementStock(dto.ticketTypeId, dto.quantity);
    } catch (error) {
      if (
        error instanceof InsufficientStockError ||
        error instanceof StockNotInitializedError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const expiresAt = new Date(
      Date.now() + ORDER_EXPIRY_MINUTES * 60 * 1000,
    );
    const totalAmount = ticketType.price * dto.quantity;

    let order;
    try {
      order = await this.prisma.order.create({
        data: {
          userId,
          ticketTypeId: dto.ticketTypeId,
          quantity: dto.quantity,
          totalAmount,
          expiresAt,
        },
      });
    } catch (error) {
      // Roll back the reservation if persisting the order fails.
      await this.inventory.releaseStock(dto.ticketTypeId, dto.quantity);
      throw error;
    }

    await this.expiryQueue.add(
      'expire-order',
      { orderId: order.id, ticketTypeId: dto.ticketTypeId, quantity: dto.quantity },
      { delay: ORDER_EXPIRY_MINUTES * 60 * 1000 },
    );

    return order;
  }

  async findOrder(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  /** Simulates a successful payment for the given pending order. */
  async pay(id: string) {
    const order = await this.findOrder(id);
    if (order.status !== 'PENDING') {
      throw new BadRequestException(`Order ${id} is not pending payment`);
    }
    return this.prisma.order.update({
      where: { id },
      data: { status: 'PAID' },
    });
  }

  /** Called by the expiry processor; releases stock if still pending. */
  async expireIfPending(orderId: string, ticketTypeId: string, quantity: number) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== 'PENDING') return;

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: 'EXPIRED' },
    });
    await this.inventory.releaseStock(ticketTypeId, quantity);
  }
}
