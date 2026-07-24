import { Module } from '@nestjs/common';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { InventoryModule } from '../inventory/inventory.module';
import { AuthModule } from '../auth/auth.module';
import { QueueRoomModule } from '../queue-room/queue-room.module';
import { EventModule } from '../event/event.module';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [InventoryModule, AuthModule, QueueRoomModule, EventModule, EmailModule],
  controllers: [OrderController],
  providers: [OrderService],
})
export class OrderModule {}
