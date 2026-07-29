import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CompanionDto } from './create-order.dto';

/**
 * Self-service edit for a non-group order's own registrant/companion
 * details after purchase (group tickets have their own updateGroupMembers
 * endpoint instead). `companions` is only meaningful — and only validated —
 * on a multi-quantity individual ticket type; a plain single-ticket order
 * just omits it.
 */
export class UpdateRegistrantInfoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  registrantName: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  registrantTeam: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  registrantLineId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  registrantPhone: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  mealPreference: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CompanionDto)
  companions?: CompanionDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  childSeatCount?: number;
}
