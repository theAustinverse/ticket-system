import { IsBoolean, IsString, Length } from 'class-validator';

/**
 * The recipient reviews/edits this data in a confirmation form right before
 * accepting — it's exactly what goes into the admin reconciliation notice,
 * so letting them correct a stale/wrong name or meal preference here avoids
 * a bad notice going out that the admin team then has to chase down.
 */
export class AcceptTransferDto {
  @IsString()
  @Length(1, 100)
  fromName: string;

  @IsString()
  @Length(1, 100)
  toName: string;

  @IsString()
  @Length(1, 50)
  mealPreference: string;

  @IsBoolean()
  buyingForFamily: boolean;
}
