import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../anti-bot/rate-limit.decorator';
import { SponsorshipService } from './sponsorship.service';
import { CreateSponsorshipDto } from './dto/create-sponsorship.dto';
import { ReportSponsorshipDto } from './dto/report-sponsorship.dto';
import { UpdateSponsorshipStatusDto } from './dto/update-sponsorship-status.dto';

@Controller('sponsorships')
export class SponsorshipController {
  constructor(private readonly service: SponsorshipService) {}

  @Get('info')
  info() {
    return this.service.getInfo();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @RateLimit(5, 60)
  create(@Req() req: any, @Body() dto: CreateSponsorshipDto) {
    return this.service.create(req.user.userId, dto.amount);
  }

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @RateLimit(10, 60)
  report(@Req() req: any, @Param('id') id: string, @Body() dto: ReportSponsorshipDto) {
    return this.service.report(req.user.userId, id, dto.referenceCode);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@Req() req: any) {
    return this.service.listMine(req.user.userId);
  }
}

@Controller('admin/sponsorships')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminSponsorshipController {
  constructor(private readonly service: SponsorshipService) {}

  @Get()
  list() {
    return this.service.listAll();
  }

  @Patch(':id')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateSponsorshipStatusDto) {
    return this.service.updateStatus(id, dto.status);
  }
}
