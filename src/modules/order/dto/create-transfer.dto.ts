import { IsEmail } from 'class-validator';

export class CreateTransferDto {
  @IsEmail()
  toEmail: string;
}
