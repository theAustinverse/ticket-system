import { IsDateString, IsString, MinLength } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  venue: string;

  @IsDateString()
  startTime: string;
}
