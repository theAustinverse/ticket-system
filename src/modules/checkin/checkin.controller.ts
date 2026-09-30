import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckinGuard } from '../auth/checkin.guard';
import { RateLimit } from '../anti-bot/rate-limit.decorator';
import { CheckinService } from './checkin.service';

/** The staff name from a door login, or the back-office username if an admin is scanning. */
function staffLabel(req: any): string {
  const user = req.user ?? {};
  return user.role === 'CHECKIN' && user.name ? user.name : `後台 ${user.email ?? ''}`.trim();
}

// Limits are set well above the global default on purpose. RateLimitGuard is
// global, so it runs before JwtAuthGuard has decoded anyone — it buckets by
// client IP alone here — and door scanners on the venue Wi-Fi usually share
// one public IP. They all land in ONE bucket per route, and the default
// (20 per 10s) split across several phones would start refusing scans at
// exactly the moment the queue is longest.
@Controller('checkin')
@UseGuards(JwtAuthGuard, CheckinGuard)
export class CheckinController {
  constructor(private readonly checkinService: CheckinService) {}

  @Get('scan/:token')
  @RateLimit(600, 60)
  scan(@Param('token') token: string) {
    return this.checkinService.scan(token);
  }

  @Post('tickets/:id')
  @RateLimit(600, 60)
  checkIn(@Req() req: any, @Param('id') id: string) {
    return this.checkinService.checkIn(id, staffLabel(req));
  }

  @Post('tickets/:id/undo')
  @RateLimit(60, 60)
  undo(@Req() req: any, @Param('id') id: string) {
    return this.checkinService.undoCheckIn(id, staffLabel(req));
  }

  @Get('search')
  @RateLimit(300, 60)
  search(@Query('q') q?: string) {
    return this.checkinService.search(q ?? '');
  }

  @Get('roster')
  @RateLimit(120, 60)
  roster() {
    return this.checkinService.roster();
  }

  @Get('stats')
  @RateLimit(300, 60)
  stats() {
    return this.checkinService.stats();
  }
}

/**
 * No login: this is what a group member opens from the link their leader
 * forwarded. The token is the credential, and it's 128 random bits, so the
 * rate limit here is about scraping load, not about guessing.
 */
@Controller('tickets')
export class PublicTicketController {
  constructor(private readonly checkinService: CheckinService) {}

  @Get(':token')
  @RateLimit(30, 60)
  get(@Param('token') token: string) {
    return this.checkinService.publicTicket(token);
  }
}
