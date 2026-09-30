import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CheckinController, PublicTicketController } from './checkin.controller';
import { CheckinService } from './checkin.service';

@Module({
  imports: [AuthModule],
  controllers: [CheckinController, PublicTicketController],
  providers: [CheckinService],
})
export class CheckinModule {}
