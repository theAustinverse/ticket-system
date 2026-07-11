import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { OrderService } from './order.service';
import { ORDER_EXPIRY_QUEUE } from './order.constants';

interface ExpireOrderJobData {
  orderId: string;
  ticketTypeId: string;
  quantity: number;
}

@Processor(ORDER_EXPIRY_QUEUE)
export class OrderExpiryProcessor extends WorkerHost {
  constructor(private readonly orderService: OrderService) {
    super();
  }

  async process(job: Job<ExpireOrderJobData>): Promise<void> {
    const { orderId, ticketTypeId, quantity } = job.data;
    await this.orderService.expireIfPending(orderId, ticketTypeId, quantity);
  }
}
