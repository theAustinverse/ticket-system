import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class BulkDeleteOrdersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}
