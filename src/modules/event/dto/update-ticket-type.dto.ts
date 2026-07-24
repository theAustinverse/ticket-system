import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * Admin-only, partial update — scoped to fields that need setting after a
 * ticket type already exists (e.g. migrating an existing ticket type onto a
 * shared pool, or turning on multi-quantity purchase for a later wave).
 */
export class UpdateTicketTypeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  maxQuantityPerOrder?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sharedStockKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  poolTotalQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxGroupOrders?: number;

  @IsOptional()
  @IsBoolean()
  requiresPasscode?: boolean;
}
