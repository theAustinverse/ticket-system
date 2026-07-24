import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[一-鿿]+$/, { message: '姓名必須為中文全名' })
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  team: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lineId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone: string;
}
