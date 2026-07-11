import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { QueueRoomService } from './queue-room.service';

/**
 * Blocks requests to order-creation endpoints unless the caller's queue
 * token has already been admitted, forcing all traffic through the
 * virtual waiting room instead of hitting the order API directly.
 */
@Injectable()
export class AdmissionGuard implements CanActivate {
  constructor(private readonly queueRoomService: QueueRoomService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers['x-queue-token'];
    const { ticketTypeId } = request.body ?? {};

    if (!token || !ticketTypeId) {
      throw new ForbiddenException('Missing queue token or ticket type');
    }

    const admitted = await this.queueRoomService.isAdmitted(
      ticketTypeId,
      token,
    );
    if (!admitted) {
      throw new ForbiddenException('Not admitted from the waiting room yet');
    }
    return true;
  }
}
