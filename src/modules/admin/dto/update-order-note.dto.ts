import { IsString, MaxLength } from 'class-validator';

export class UpdateOrderNoteDto {
  @IsString()
  @MaxLength(2000)
  note: string;
}
