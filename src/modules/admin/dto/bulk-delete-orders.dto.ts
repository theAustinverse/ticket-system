import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/** Caps a single bulk-delete request — a stolen admin session shouldn't be able to wipe the whole table in one call. */
const MAX_BULK_DELETE = 200;

export class BulkDeleteOrdersDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_BULK_DELETE)
  @IsString({ each: true })
  ids: string[];
}
