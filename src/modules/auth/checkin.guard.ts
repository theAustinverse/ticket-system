import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

/**
 * Must run after JwtAuthGuard. Admits the door-staff role and the back
 * office alike — but nothing else admits CHECKIN: AdminGuard only lets ADMIN
 * through, so a lost scanner phone can check people in and look them up, and
 * nothing more.
 */
@Injectable()
export class CheckinGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const role = req.user?.role;
    if (role !== 'CHECKIN' && role !== 'ADMIN') {
      throw new ForbiddenException('Check-in access required');
    }
    return true;
  }
}
