import { IsString, MaxLength, MinLength } from 'class-validator';

export class AskHelpDto {
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  question!: string;
}

export class ReplyHelpDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reply!: string;
}
