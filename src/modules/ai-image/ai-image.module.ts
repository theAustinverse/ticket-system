import { Module } from '@nestjs/common';
import { AiImageController } from './ai-image.controller';
import { AiImageService } from './ai-image.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AiImageController],
  providers: [AiImageService],
})
export class AiImageModule {}
