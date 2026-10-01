import { IsString, Matches, MaxLength, MinLength, IsIn } from 'class-validator';
import { TEAM_MESSAGE, TEAM_OPTIONS } from '../../../common/team-options';

export class UpdateProfileDto {
  @IsString()
  @MaxLength(50)
  @Matches(/^[一-鿿]+$/, { message: '姓名必須為中文全名' })
  name: string;

  @IsString()
  @IsIn(TEAM_OPTIONS as string[], { message: TEAM_MESSAGE })
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
