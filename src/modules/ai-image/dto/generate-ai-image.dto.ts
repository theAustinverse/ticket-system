import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'] as const;

export class GenerateAiImageDto {
  @IsString()
  @MaxLength(2000)
  prompt: string;

  @IsOptional()
  @IsIn(ASPECT_RATIOS)
  aspectRatio?: (typeof ASPECT_RATIOS)[number];
}
