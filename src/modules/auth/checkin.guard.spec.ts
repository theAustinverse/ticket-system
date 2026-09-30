import { ForbiddenException } from '@nestjs/common';
import { CheckinGuard } from './checkin.guard';
import { AdminGuard } from './admin.guard';

function ctx(role?: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
  } as any;
}

describe('CheckinGuard / AdminGuard boundary', () => {
  it.each(['CHECKIN', 'ADMIN'])('CheckinGuard admits %s', (role) => {
    expect(new CheckinGuard().canActivate(ctx(role))).toBe(true);
  });

  it.each(['USER', undefined])('CheckinGuard refuses %s', (role) => {
    expect(() => new CheckinGuard().canActivate(ctx(role))).toThrow(ForbiddenException);
  });

  it('a check-in staff token cannot reach the back office', () => {
    expect(() => new AdminGuard().canActivate(ctx('CHECKIN'))).toThrow(ForbiddenException);
  });
});
