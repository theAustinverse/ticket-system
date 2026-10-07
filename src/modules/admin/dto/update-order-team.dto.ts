import { IsIn } from 'class-validator';
import { TEAM_MESSAGE, TEAM_OPTIONS } from '../../../common/team-options';

export class UpdateOrderTeamDto {
  @IsIn(TEAM_OPTIONS as string[], { message: TEAM_MESSAGE })
  team: string;
}
