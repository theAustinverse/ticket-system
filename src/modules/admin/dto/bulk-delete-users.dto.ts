import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class BulkDeleteUsersDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids: string[];
}
