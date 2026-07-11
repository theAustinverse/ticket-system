import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSaleBatchDto {
  @IsString()
  @MinLength(1)
  name: string;

  /** Omit or leave null when the wave's start time is still TBD. */
  @IsOptional()
  @IsDateString()
  saleStartAt?: string;
}
