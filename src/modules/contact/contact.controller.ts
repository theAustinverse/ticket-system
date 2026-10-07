import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { RateLimit } from '../anti-bot/rate-limit.decorator';
import { ContactService } from './contact.service';
import { CreateContactDto, UpdateContactDto } from './dto/contact.dto';

/** Public: anyone, signed in or not, can see who to contact. */
@Controller('contacts')
export class ContactController {
  constructor(private readonly service: ContactService) {}

  @Get()
  @RateLimit(60, 60)
  list() {
    return this.service.list();
  }
}

@Controller('admin/contacts')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminContactController {
  constructor(private readonly service: ContactService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  @RateLimit(30, 60)
  create(@Body() dto: CreateContactDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RateLimit(60, 60)
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
