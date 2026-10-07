import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminContactController, ContactController } from './contact.controller';
import { ContactService } from './contact.service';

@Module({
  imports: [AuthModule],
  controllers: [ContactController, AdminContactController],
  providers: [ContactService],
})
export class ContactModule {}
