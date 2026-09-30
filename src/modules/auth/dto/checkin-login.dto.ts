import { IsString, MaxLength, MinLength } from 'class-validator';

export class CheckinLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  username: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password: string;

  /** Who is holding this scanner — recorded on every check-in they make. */
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  staffName: string;
}
