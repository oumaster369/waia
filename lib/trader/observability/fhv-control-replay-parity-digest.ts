import { createHash } from "node:crypto";

export const CONTROL_REPLAY_PARITY_DIGEST_VERSION = "control-replay-parity/v1" as const;

export type ControlReplayNormalizedSurface = {
  executionPurpose: string;
  executionMode: string;
  authorityClass: string;
  capitalEligible: boolean;
  decisionActionable: boolean;
  evLowerScale8: string;
  evBaseScale8: string;
  evUpperScale8: string;
  orderCount: number;
  fillCount: number;
  checkpointDigest: string;
  semanticParityDigest: string;
};

function canonicalizeSurface(surface: ControlReplayNormalizedSurface): string {
  return JSON.stringify({
    version: CONTROL_REPLAY_PARITY_DIGEST_VERSION,
    executionPurpose: surface.executionPurpose,
    executionMode: surface.executionMode,
    authorityClass: surface.authorityClass,
    capitalEligible: surface.capitalEligible,
    decisionActionable: surface.decisionActionable,
    evLowerScale8: surface.evLowerScale8,
    evBaseScale8: surface.evBaseScale8,
    evUpperScale8: surface.evUpperScale8,
    orderCount: surface.orderCount,
    fillCount: surface.fillCount,
    checkpointDigest: surface.checkpointDigest,
    semanticParityDigest: surface.semanticParityDigest,
  });
}

export function computeControlReplayParityDigest(surface: ControlReplayNormalizedSurface): string {
  return createHash("sha256").update(canonicalizeSurface(surface), "utf8").digest("hex");
}

export function assertControlReplayParityEqual(runOneDigest: string, runTwoDigest: string): void {
  if (runOneDigest !== runTwoDigest) {
    throw new Error(
      `[control-replay-parity] digest mismatch run1=${runOneDigest} run2=${runTwoDigest}`,
    );
  }
}
