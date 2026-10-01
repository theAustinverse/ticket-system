import { IsInt, Max, Min } from 'class-validator';
import { SPONSOR_MAX_AMOUNT, SPONSOR_MIN_AMOUNT } from '../sponsorship.constants';

export class CreateSponsorshipDto {
  @IsInt()
  @Min(SPONSOR_MIN_AMOUNT)
  @Max(SPONSOR_MAX_AMOUNT)
  amount: number;
}
