import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateSaleBatchDto } from './dto/create-sale-batch.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';
import { UpdateTicketTypeDto } from './dto/update-ticket-type.dto';
import { UpdateSaleBatchDto } from './dto/update-sale-batch.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';

@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  // The GET endpoints below stay public (browsing events requires no
  // account), but every mutating endpoint is back-office-only — without
  // these guards, anyone on the internet could create events, sessions,
  // waves, and ticket types directly against production.
  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  createEvent(@Body() dto: CreateEventDto) {
    return this.eventService.createEvent(dto);
  }

  @Get()
  findAllEvents() {
    return this.eventService.findAllEvents();
  }

  @Get(':id')
  findEvent(@Param('id') id: string) {
    return this.eventService.findEvent(id);
  }

  @Post(':id/sessions')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createSession(@Param('id') eventId: string, @Body() dto: CreateSessionDto) {
    return this.eventService.createSession(eventId, dto);
  }

  @Post('sessions/:sessionId/batches')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createBatch(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateSaleBatchDto,
  ) {
    return this.eventService.createBatch(sessionId, dto);
  }

  @Patch('batches/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateBatch(@Param('id') id: string, @Body() dto: UpdateSaleBatchDto) {
    return this.eventService.updateBatch(id, dto);
  }

  @Post('batches/:batchId/ticket-types')
  @UseGuards(JwtAuthGuard, AdminGuard)
  createTicketType(
    @Param('batchId') batchId: string,
    @Body() dto: CreateTicketTypeDto,
  ) {
    return this.eventService.createTicketType(batchId, dto);
  }

  @Get('ticket-types/:id')
  findTicketType(@Param('id') id: string) {
    return this.eventService.findTicketType(id);
  }

  @Patch('ticket-types/:id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  updateTicketType(
    @Param('id') id: string,
    @Body() dto: UpdateTicketTypeDto,
  ) {
    return this.eventService.updateTicketType(id, dto);
  }
}
