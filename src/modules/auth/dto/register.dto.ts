import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  @Matches(/@gmail\.com$/i, {
    message: 'Only @gmail.com email addresses are accepted',
  })
  email: string;

  // Upper bound guards against a bcrypt-DoS: bcrypt cost scales with input
  // length, so an unbounded password lets an attacker burn CPU per request.
  @MinLength(8)
  @MaxLength(72)
  password: string;
}
