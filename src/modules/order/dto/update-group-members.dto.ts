import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { GroupMemberDto } from './create-order.dto';

export class UpdateGroupMembersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GroupMemberDto)
  groupMembers: GroupMemberDto[];

  /** Total child seats needed for this group order. 0 means no need. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(15)
  childSeatCount?: number;
}
