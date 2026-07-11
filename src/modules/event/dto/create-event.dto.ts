import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateEventDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
