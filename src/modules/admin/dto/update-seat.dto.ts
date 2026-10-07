import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Back-office edit of one seat. Every field is optional so a correction
 * touches only what changed; a name, when sent, can't be blank (use the
 * cancel action to take a person off instead of blanking them out).
 */
export class UpdateSeatDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  mealPreference?: string;
}
