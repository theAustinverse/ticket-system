import { IsDateString, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  venue: string;

  @IsDateString()
  startTime: string;

  // https only: the value becomes a link on the event page, and a
  // `javascript:` URL there would run in a visitor's browser when clicked.
  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  mapUrl?: string;
}
