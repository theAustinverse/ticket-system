import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class CreateTicketTypeDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsInt()
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  totalQuantity: number;

  /** Set for bundles like a group ticket, where every order must buy exactly this many. */
  @IsOptional()
  @IsInt()
  @Min(1)
  fixedQuantity?: number;
}
