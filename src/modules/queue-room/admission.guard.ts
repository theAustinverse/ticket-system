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
    // Populated by JwtAuthGuard, which always runs before this guard.
    const userId = request.user?.userId;

    if (!token || !ticketTypeId) {
      throw new ForbiddenException('Missing queue token or ticket type');
    }

    // Bound to whoever the token was issued to — otherwise one person could
    // hand or forward their admitted token to someone else and let them
    // skip the queue entirely.
    const owned = await this.queueRoomService.isOwnedBy(
      ticketTypeId,
      token,
      userId,
    );
    if (!owned) {
      throw new ForbiddenException('This queue token does not belong to you');
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
