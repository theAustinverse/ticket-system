import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateGroupMembersDto } from './dto/update-group-members.dto';
import { CreateTransferDto } from './dto/create-transfer.dto';
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
    return this.orderService.createOrder(
      req.user.userId,
      dto,
      req.headers['x-queue-token'],
    );
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  listMyOrders(@Req() req: any) {
    return this.orderService.listMyOrders(req.user.userId);
  }

  // Must be declared before the generic ':id' GET route below, otherwise
  // Nest would match "transfers" itself as the ':id' param.
  @Get('transfers/incoming')
  @UseGuards(JwtAuthGuard)
  listIncomingTransfers(@Req() req: any) {
    return this.orderService.listIncomingTransfers(req.user.userId);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  findOrder(@Req() req: any, @Param('id') id: string) {
    return this.orderService.findOrder(req.user.userId, id);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  cancel(@Req() req: any, @Param('id') id: string) {
    return this.orderService.cancelOrder(req.user.userId, id);
  }

  @Patch(':id/group-members')
  @UseGuards(JwtAuthGuard)
  updateGroupMembers(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateGroupMembersDto,
  ) {
    return this.orderService.updateGroupMembers(
      req.user.userId,
      id,
      dto.groupMembers,
      dto.childSeatCount,
    );
  }

  @Post(':id/transfer')
  @RateLimit(5, 60)
  @UseGuards(JwtAuthGuard)
  createTransfer(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: CreateTransferDto,
  ) {
    return this.orderService.createTransfer(req.user.userId, id, dto.toEmail);
  }

  @Post('transfers/:transferId/accept')
  @UseGuards(JwtAuthGuard)
  acceptTransfer(@Req() req: any, @Param('transferId') transferId: string) {
    return this.orderService.acceptTransfer(req.user.userId, transferId);
  }

  @Post('transfers/:transferId/reject')
  @UseGuards(JwtAuthGuard)
  rejectTransfer(@Req() req: any, @Param('transferId') transferId: string) {
    return this.orderService.rejectTransfer(req.user.userId, transferId);
  }

  @Post('transfers/:transferId/cancel')
  @UseGuards(JwtAuthGuard)
  cancelTransfer(@Req() req: any, @Param('transferId') transferId: string) {
    return this.orderService.cancelTransfer(req.user.userId, transferId);
  }
}
