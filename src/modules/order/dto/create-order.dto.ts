import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  ticketTypeId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  @MinLength(1)
  registrantName: string;

  @IsString()
  @MinLength(1)
  registrantTeam: string;

  @IsString()
  @MinLength(1)
  registrantLineId: string;

  @IsString()
  @MinLength(1)
  registrantPhone: string;

  /** Required only for group ticket types (ticketType.fixedQuantity is set). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  groupLeaderName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  groupLeaderLineId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  groupLeaderPhone?: string;

  /** Required only for group ticket types; length must match ticketType.fixedQuantity. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  groupMembers?: string[];
}
