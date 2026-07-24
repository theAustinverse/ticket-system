import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { QueueRoomService } from './queue-room.service';
import { RateLimit } from '../anti-bot/rate-limit.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EnterQueueDto } from './dto/enter-queue.dto';

@Controller('queue/:ticketTypeId')
export class QueueRoomController {
  constructor(private readonly queueRoomService: QueueRoomService) {}

  @Post('enter')
  @RateLimit(3, 5)
  @UseGuards(JwtAuthGuard)
  async enter(
    @Req() req: any,
    @Param('ticketTypeId') ticketTypeId: string,
    @Body() dto: EnterQueueDto,
  ) {
    const token = await this.queueRoomService.enter(
      ticketTypeId,
      req.user.userId,
      dto.passcode,
    );
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
