import { IsOptional, IsString, MaxLength } from 'class-validator';

export class EnterQueueDto {
  /** Only required for a ticket type with requiresPasscode set. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  passcode?: string;
}
