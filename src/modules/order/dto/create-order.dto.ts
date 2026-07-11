import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @MinLength(1)
  ticketTypeId: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
