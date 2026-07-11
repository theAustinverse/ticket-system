import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { EventService } from './event.service';
import { CreateEventDto } from './dto/create-event.dto';
import { CreateSessionDto } from './dto/create-session.dto';
import { CreateSaleBatchDto } from './dto/create-sale-batch.dto';
import { CreateTicketTypeDto } from './dto/create-ticket-type.dto';

@Controller('events')
export class EventController {
  constructor(private readonly eventService: EventService) {}

  @Post()
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
  createSession(@Param('id') eventId: string, @Body() dto: CreateSessionDto) {
    return this.eventService.createSession(eventId, dto);
  }

  @Post('sessions/:sessionId/batches')
  createBatch(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateSaleBatchDto,
  ) {
    return this.eventService.createBatch(sessionId, dto);
  }

  @Post('batches/:batchId/ticket-types')
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
}
