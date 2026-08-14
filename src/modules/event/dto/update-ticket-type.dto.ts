import { IsBoolean, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

/**
 * Admin-only, partial update — scoped to fields that need setting after a
 * ticket type already exists (e.g. migrating an existing ticket type onto a
 * shared pool, or turning on multi-quantity purchase for a later wave).
 */
export class UpdateTicketTypeDto {
  /**
   * The ticket type's own capacity. On a pooled ticket type (sharedStockKey
   * set) this is display/record-keeping only — the real ceiling is the
   * pool's poolTotalQuantity, updated separately. Either way this does NOT
   * touch Redis; see the doc comment on EventService.updateTicketType.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  totalQuantity?: number;

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
