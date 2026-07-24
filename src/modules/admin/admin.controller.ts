import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { UpdateOrderNoteDto } from './dto/update-order-note.dto';
import { BulkDeleteUsersDto } from './dto/bulk-delete-users.dto';
import { BulkDeleteOrdersDto } from './dto/bulk-delete-orders.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers() {
    return this.adminService.listUsers();
  }

  @Delete('users/:id')
  deleteUser(@Param('id') id: string) {
    return this.adminService.deleteUser(id);
  }

  @Post('users/delete-bulk')
  bulkDeleteUsers(@Body() dto: BulkDeleteUsersDto) {
    return this.adminService.bulkDeleteUsers(dto.ids);
  }

  @Get('orders')
  listOrders() {
    return this.adminService.listOrdersFlat();
  }

  @Get('team-stats')
  getTeamStats() {
    return this.adminService.getTeamStats();
  }

  @Patch('orders/:id/note')
  updateOrderNote(@Param('id') id: string, @Body() dto: UpdateOrderNoteDto) {
    return this.adminService.updateOrderNote(id, dto.note);
  }

  @Delete('orders/:id')
  deleteOrder(@Param('id') id: string) {
    return this.adminService.deleteOrder(id);
  }

  @Post('orders/delete-bulk')
  bulkDeleteOrders(@Body() dto: BulkDeleteOrdersDto) {
    return this.adminService.bulkDeleteOrders(dto.ids);
  }

  @Post('reset-stock')
  resetStock() {
    return this.adminService.resetStock();
  }

  @Delete('load-test-users')
  deleteLoadTestUsers() {
    return this.adminService.deleteLoadTestUsers();
  }

  @Delete('chat/:id')
  deleteChatMessage(@Param('id') id: string) {
    return this.adminService.deleteChatMessage(id);
  }

  @Get('export')
  async exportOrders(@Res() res: Response, @Query('team') team?: string) {
    const buffer = await this.adminService.exportOrdersXlsx(team);
    // Team names may contain non-ASCII (Chinese) characters, which Node's
    // raw HTTP header setter rejects — use the RFC 5987 filename* form for
    // the real (UTF-8) name and keep a plain-ASCII fallback filename.
    const displayName = team ? `orders-${team}.xlsx` : 'orders.xlsx';
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="orders.xlsx"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
    });
    res.send(buffer);
  }
}
