import { Module } from '@nestjs/common';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { StockSweepService } from './stock-sweep.service';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule],
  controllers: [EventController],
  providers: [EventService, StockSweepService],
  exports: [EventService],
})
export class EventModule {}
