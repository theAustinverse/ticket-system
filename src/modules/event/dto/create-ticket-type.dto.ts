import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

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

  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantityPerOrder?: number;

  /**
   * When set, this ticket type shares its stock pool with every other
   * ticket type carrying the same string — see TicketType.sharedStockKey.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  sharedStockKey?: string;

  /** Required alongside sharedStockKey — must match on every ticket type sharing the key. */
  @IsOptional()
  @IsInt()
  @Min(1)
  poolTotalQuantity?: number;

  /** Only meaningful on a shared-pool group ticket type (fixedQuantity set). */
  @IsOptional()
  @IsInt()
  @Min(1)
  maxGroupOrders?: number;

  @IsOptional()
  @IsBoolean()
  requiresPasscode?: boolean;
}
