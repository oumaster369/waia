import type { TreasuryObservationStatus } from "@/lib/waia-core/treasury/types";

export function observationStatusFromDepth(input: {
  depth: number;
  confirmationsRequired: number;
}): TreasuryObservationStatus | null {
  if (input.depth <= 0) {
    return null;
  }
  if (input.depth >= input.confirmationsRequired) {
    return "CONFIRMED";
  }
  return "OBSERVED";
}

export function isReorgAgeoutEligible(createdAt: Date, now: Date, ageoutMinutes: number): boolean {
  return now.getTime() - createdAt.getTime() >= ageoutMinutes * 60 * 1000;
}
