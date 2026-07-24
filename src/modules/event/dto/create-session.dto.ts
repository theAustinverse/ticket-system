import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  venue: string;

  @IsDateString()
  startTime: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  mapUrl?: string;
}
