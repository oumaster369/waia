import { createHash } from "node:crypto";

export const TRIAL_ID_VERSION = "trial-id/v2" as const;

export type TrialIdentityInput = {
  scoringContractVersion: string;
  evaluationPartitionReceiptDigestHex: string;
  venue: string;
  market: string;
  symbol: string;
  primaryHorizonMinutes: number;
  modelTransformVersion: string;
  challengerPackageContentDigestHex: string;
  baselineId: string;
  metricId: string;
  commonAnchorSetDigestHex: string;
  purgeDurationMinutes: number;
  embargoDurationMinutes: number;
  comparisonFamilyId: string;
};

function line(value: string): Buffer {
  return Buffer.from(`${value}\n`, "utf8");
}

/** Exact trial-id/v2 serialization (§2.11.5). Holm rank excluded. */
export function serializeTrialIdentityV2(input: TrialIdentityInput): Buffer {
  return Buffer.concat([
    line(TRIAL_ID_VERSION),
    line(input.scoringContractVersion),
    line(input.evaluationPartitionReceiptDigestHex),
    line(input.venue),
    line(input.market),
    line(input.symbol),
    line(String(input.primaryHorizonMinutes)),
    line(input.modelTransformVersion),
    line(input.challengerPackageContentDigestHex),
    line(input.baselineId),
    line(input.metricId),
    line(input.commonAnchorSetDigestHex),
    line(String(input.purgeDurationMinutes)),
    line(String(input.embargoDurationMinutes)),
    line(input.comparisonFamilyId),
  ]);
}

export function computeTrialIdentityDigestV2(input: TrialIdentityInput): Buffer {
  return createHash("sha256").update(serializeTrialIdentityV2(input)).digest();
}

export function digestHex(digest: Buffer): string {
  return digest.toString("hex");
}
