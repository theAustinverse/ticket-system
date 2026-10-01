import { IsString, Matches } from 'class-validator';

export class ReportSponsorshipDto {
  @IsString()
  @Matches(/^\d{6}$/)
  referenceCode: string;
}
