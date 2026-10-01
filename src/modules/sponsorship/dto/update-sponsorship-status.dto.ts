import { IsIn } from 'class-validator';

export class UpdateSponsorshipStatusDto {
  @IsIn(['PENDING', 'RECEIVED', 'CANCELLED'])
  status: 'PENDING' | 'RECEIVED' | 'CANCELLED';
}
