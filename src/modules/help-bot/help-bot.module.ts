import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';
import { HelpBotBrain } from './help-bot.brain';
import { AdminHelpBotController, HelpBotController } from './help-bot.controller';
import { HelpBotService } from './help-bot.service';

@Module({
  imports: [AuthModule, EmailModule],
  controllers: [HelpBotController, AdminHelpBotController],
  providers: [HelpBotService, HelpBotBrain],
})
export class HelpBotModule {}
