import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [AuthModule, InventoryModule, ChatModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
