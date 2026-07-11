import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { QueueRoomService } from './queue-room.service';
import { RateLimit } from '../anti-bot/rate-limit.decorator';

@Controller('queue/:ticketTypeId')
export class QueueRoomController {
  constructor(private readonly queueRoomService: QueueRoomService) {}

  @Post('enter')
  @RateLimit(3, 5)
  async enter(@Param('ticketTypeId') ticketTypeId: string) {
    const token = await this.queueRoomService.enter(ticketTypeId);
    return { token };
  }

  @Get('status')
  getStatus(
    @Param('ticketTypeId') ticketTypeId: string,
    @Query('token') token: string,
  ) {
    return this.queueRoomService.getStatus(ticketTypeId, token);
  }
}
