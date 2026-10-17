import { IsOptional, IsString, Matches } from 'class-validator';

export class ReportSponsorshipDto {
  @IsString()
  @Matches(/^\d{6}$/)
  referenceCode: string;

  /** Only for a crypto payment: the BNB Smart Chain (BEP-20) transaction hash. */
  @IsOptional()
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{64}$/, { message: '交易哈希格式不正確（0x 開頭，共 66 個字元）' })
  txHash?: string;
}
