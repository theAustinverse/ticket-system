import { Module } from '@nestjs/common';
import { QueueRoomController } from './queue-room.controller';
import { QueueRoomService } from './queue-room.service';
import { AdmissionGuard } from './admission.guard';

@Module({
  controllers: [QueueRoomController],
  providers: [QueueRoomService, AdmissionGuard],
  exports: [QueueRoomService, AdmissionGuard],
})
export class QueueRoomModule {}
