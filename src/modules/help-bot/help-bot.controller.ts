import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../anti-bot/rate-limit.decorator';
import { HelpQuestionStatus } from '../../generated/prisma/client';
import { HelpBotService } from './help-bot.service';
import { AskHelpDto, ReplyHelpDto } from './dto/help-bot.dto';

@Controller('help')
@UseGuards(JwtAuthGuard)
export class HelpBotController {
  constructor(private readonly service: HelpBotService) {}

  @Get('mine')
  @RateLimit(60, 60)
  mine(@Request() req: any) {
    return this.service.listMine(req.user.userId);
  }

  @Post('ask')
  @RateLimit(6, 60)
  async ask(@Request() req: any, @Body() dto: AskHelpDto) {
    const result = await this.service.ask(req.user.userId, dto.question);
    if (result.tooMany) {
      throw new HttpException(
        '今天問得有點多了，請明天再來，或到「聯絡我們」找窗口',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return result.item;
  }
}

@Controller('admin/help')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminHelpBotController {
  constructor(private readonly service: HelpBotService) {}

  @Get()
  list(@Query('status') status?: string) {
    const valid = Object.values(HelpQuestionStatus) as string[];
    return this.service.listForAdmin(
      status && valid.includes(status) ? (status as HelpQuestionStatus) : undefined,
    );
  }

  @Post(':id/reply')
  @RateLimit(60, 60)
  reply(@Param('id') id: string, @Body() dto: ReplyHelpDto) {
    return this.service.reply(id, dto.reply);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
