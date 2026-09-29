import { IsEmail, Length, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @Length(6, 6)
  code: string;

  // Same bounds as RegisterDto — the upper bound guards against a
  // bcrypt-DoS, since bcrypt cost scales with input length.
  @MinLength(8)
  @MaxLength(72)
  newPassword: string;
}
