import { IsBoolean, IsOptional } from 'class-validator';

export class ResetStockDto {
  /** Go ahead even though a wave is on sale right now (see AdminService.resetStock). */
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
