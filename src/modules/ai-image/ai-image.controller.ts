import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AiImageService } from './ai-image.service';
import { GenerateAiImageDto } from './dto/generate-ai-image.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('admin/ai-image')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AiImageController {
  constructor(private readonly aiImageService: AiImageService) {}

  @Post('generate')
  generate(@Body() dto: GenerateAiImageDto) {
    return this.aiImageService.generate(dto);
  }
}
