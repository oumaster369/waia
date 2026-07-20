import type { SessionPhase } from "@/lib/trader/market-data/observation-types";

/**
 * UTC session phase for observation tagging (PR2.5 metadata only — not a trading rule).
 */
export function classifySessionPhaseUtc(isoTimestamp: string): SessionPhase {
  const hour = new Date(isoTimestamp).getUTCHours();

  if (hour >= 13 && hour < 16) {
    return "OVERLAP";
  }
  if (hour >= 0 && hour < 8) {
    return "ASIA";
  }
  if (hour >= 8 && hour < 13) {
    return "EUROPE";
  }
  if (hour >= 16 && hour < 21) {
    return "US";
  }

  return "UNKNOWN";
}
