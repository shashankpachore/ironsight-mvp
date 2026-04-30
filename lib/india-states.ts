import { canonicalState, STATES } from "@/lib/geo/india-states-districts";

/** Backward-compatible export for existing state dropdown consumers. */
export const INDIAN_STATES_AND_UTS = STATES;

export function isValidIndiaState(value: string): boolean {
  return canonicalState(value) !== null;
}
