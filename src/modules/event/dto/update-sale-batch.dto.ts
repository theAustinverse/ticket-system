import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSaleBatchDto {
  /**
   * ISO datetime string to (re)announce the wave's open time, or null to
   * lock it back to "TBD" (no purchases possible until re-announced —
   * see EventService.assertOnSale). Omit the field entirely to leave the
   * current value untouched.
   */
  @IsOptional()
  saleStartAt?: string | null;

  /**
   * ISO datetime string for when this wave's own sale window (purchases +
   * refunds) closes, independent of the next wave's open time — or null to
   * clear it (no fixed close date). Omit to leave the current value untouched.
   */
  @IsOptional()
  saleEndAt?: string | null;

  /**
   * Only ever needs setting back to false — StockSweepService sets it true
   * itself once a sweep runs. Use this to let a batch's sweep run again
   * (e.g. it was marked done under stale data before this batch had a real
   * open time) the next time its saleStartAt is reached.
   */
  @IsOptional()
  @IsBoolean()
  stockSweepDone?: boolean;
}
