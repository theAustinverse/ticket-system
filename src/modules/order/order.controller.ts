import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdmissionGuard } from '../queue-room/admission.guard';
import { RateLimit } from '../anti-bot/rate-limit.decorator';

@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post()
  @RateLimit(5, 10)
  @UseGuards(JwtAuthGuard, AdmissionGuard)
  createOrder(@Req() req: any, @Body() dto: CreateOrderDto) {
    return this.orderService.createOrder(req.user.userId, dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOrder(@Param('id') id: string) {
    return this.orderService.findOrder(id);
  }

  @Post(':id/pay')
  @UseGuards(JwtAuthGuard)
  pay(@Param('id') id: string) {
    return this.orderService.pay(id);
  }
}
