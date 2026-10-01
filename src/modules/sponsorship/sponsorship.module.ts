import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminSponsorshipController,
  SponsorshipController,
} from './sponsorship.controller';
import { SponsorshipService } from './sponsorship.service';

@Module({
  imports: [AuthModule],
  controllers: [SponsorshipController, AdminSponsorshipController],
  providers: [SponsorshipService],
})
export class SponsorshipModule {}
