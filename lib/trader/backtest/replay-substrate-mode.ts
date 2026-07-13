/** Default replay substrate after HTR-WP09 canvas runtime cutover. */
export type ReplaySubstrateMode = "incremental" | "legacy-oracle" | "parity-both";

export const DEFAULT_REPLAY_SUBSTRATE_MODE: ReplaySubstrateMode = "incremental";

export function usesIncrementalCanvasSubstrate(mode: ReplaySubstrateMode): boolean {
  return mode === "incremental" || mode === "parity-both";
}

export function usesLegacyOracleSubstrate(mode: ReplaySubstrateMode): boolean {
  return mode === "legacy-oracle" || mode === "parity-both";
}
