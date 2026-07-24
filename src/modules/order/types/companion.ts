/** One additional ticket (beyond the buyer's own) on a multi-quantity individual ticket type. */
export interface Companion {
  name: string;
  relationship: string;
  mealPreference: string;
  /** Required — identifies the real buyer's identity/team/contact for admin review. */
  note: string;
}
