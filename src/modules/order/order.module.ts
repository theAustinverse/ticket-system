import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { OrderExpiryProcessor } from './order-expiry.processor';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { QueueRoomModule } from '../queue-room/queue-room.module';
import { EventModule } from '../event/event.module';
import { ORDER_EXPIRY_QUEUE } from './order.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: ORDER_EXPIRY_QUEUE }),
    InventoryModule,
    AuthModule,
    QueueRoomModule,
    EventModule,
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderExpiryProcessor],
})
export class OrderModule {}
