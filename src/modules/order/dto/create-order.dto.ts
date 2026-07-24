import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class GroupMemberDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(100)
  contact: string;

  @IsString()
  @MaxLength(100)
  mealPreference: string;
}

const COMPANION_RELATIONSHIPS = ['父母', '兄弟姊妹', '伴侶', '子女'] as const;

export class CompanionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name: string;

  @IsIn(COMPANION_RELATIONSHIPS)
  relationship: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  mealPreference: string;

  /** Identifies the real buyer's identity/team/contact for admin review. */
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  note: string;
}

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  ticketTypeId: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  quantity: number;

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

  /** Required only for group ticket types (ticketType.fixedQuantity is set). */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  groupLeaderName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  groupLeaderLineId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  groupLeaderPhone?: string;

  /**
   * Required only for group ticket types; length must equal
   * ticketType.fixedQuantity - 1 (the leader is the bundle's 11th seat,
   * already covered by the group-leader fields above).
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GroupMemberDto)
  groupMembers?: GroupMemberDto[];

  /**
   * On a multi-quantity individual ticket type (TicketType.maxQuantityPerOrder):
   * - buyingForFamily false: required when quantity > 1; length must equal
   *   quantity - 1 (the buyer's own info is covered by the registrant* fields).
   * - buyingForFamily true: required; length must equal quantity (every
   *   ticket, including #1, is on behalf of a family member).
   */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CompanionDto)
  companions?: CompanionDto[];

  /**
   * Self-declared: the buyer is already a member of someone else's group
   * ticket, so this entire order is on behalf of family members — the
   * registrant* fields above are just administrative buyer identity, not an
   * actual ticket holder. Only meaningful on a multi-quantity individual
   * ticket type (TicketType.maxQuantityPerOrder).
   */
  @IsOptional()
  @IsBoolean()
  buyingForFamily?: boolean;

  /**
   * Survey only (no extra charge): how many child seats this whole order
   * needs. 0 (or omitted) means no need; capped at 4.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(4)
  childSeatCount?: number;
}
