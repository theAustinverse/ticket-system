import { BadRequestException } from '@nestjs/common';
import { OrderService } from './order.service';
import { InsufficientStockError } from '../inventory/inventory.service';
import { SaleNotOpenError } from '../event/event.service';

describe('OrderService', () => {
  let prisma: any;
  let inventory: any;
  let eventService: any;
  let expiryQueue: any;
  let service: OrderService;

  const groupTicketType = {
    id: 'tt-group',
    price: 2000,
    fixedQuantity: 11,
  };

  beforeEach(() => {
    prisma = { order: { create: jest.fn() } };
    inventory = { decrementStock: jest.fn(), releaseStock: jest.fn() };
    eventService = {
      findTicketType: jest.fn().mockResolvedValue(groupTicketType),
      assertOnSale: jest.fn().mockResolvedValue(undefined),
    };
    expiryQueue = { add: jest.fn() };
    service = new OrderService(prisma, inventory, eventService, expiryQueue);
  });

  it('rejects orders before the ticket type sale batch has opened', async () => {
    eventService.assertOnSale.mockRejectedValue(new SaleNotOpenError('tt-group'));
    await expect(
      service.createOrder('user-1', { ticketTypeId: 'tt-group', quantity: 11 }),
    ).rejects.toThrow(BadRequestException);
    expect(inventory.decrementStock).not.toHaveBeenCalled();
  });

  it('rejects a quantity that does not match fixedQuantity', async () => {
    await expect(
      service.createOrder('user-1', { ticketTypeId: 'tt-group', quantity: 5 }),
    ).rejects.toThrow(BadRequestException);
    expect(inventory.decrementStock).not.toHaveBeenCalled();
  });

  it('accepts a quantity matching fixedQuantity and snapshots totalAmount', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockResolvedValue({ id: 'order-1' });

    await service.createOrder('user-1', {
      ticketTypeId: 'tt-group',
      quantity: 11,
    });

    expect(prisma.order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ totalAmount: 22000, quantity: 11 }),
      }),
    );
  });

  it('rolls back the Redis reservation if persisting the order fails', async () => {
    inventory.decrementStock.mockResolvedValue(0);
    prisma.order.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.createOrder('user-1', { ticketTypeId: 'tt-group', quantity: 11 }),
    ).rejects.toThrow('db down');
    expect(inventory.releaseStock).toHaveBeenCalledWith('tt-group', 11);
  });

  it('surfaces insufficient stock as a BadRequestException', async () => {
    inventory.decrementStock.mockRejectedValue(
      new InsufficientStockError('tt-group'),
    );
    await expect(
      service.createOrder('user-1', { ticketTypeId: 'tt-group', quantity: 11 }),
    ).rejects.toThrow(BadRequestException);
  });
});
