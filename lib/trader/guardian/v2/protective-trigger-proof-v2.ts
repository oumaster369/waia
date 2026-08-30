import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export type ProtectiveTriggerProofV2 = Readonly<{
  schemaVersion: "waia.trader.protective_trigger_proof.v2";
  mandateId: string;
  mandateContentDigest: string;
  deterministicTriggerSpecDigest: string;
  realityProjectionId: string;
  realityContentDigest: string;
  evaluatorVersion: string;
  evaluatorDigest: string;
  observedAtUtc: string;
  triggered: true;
  contentDigest: string;
}>;

type Draft = Omit<ProtectiveTriggerProofV2, "schemaVersion" | "triggered" | "contentDigest">;
const DIGEST = /^[0-9a-f]{64}$/;

export function buildProtectiveTriggerProofV2(draft: Draft): ProtectiveTriggerProofV2 {
  for (const key of ["mandateContentDigest", "deterministicTriggerSpecDigest", "realityContentDigest", "evaluatorDigest"] as const) {
    if (!DIGEST.test(draft[key])) throw new Error("PROTECTIVE_TRIGGER_PROOF_INVALID_DIGEST");
  }
  if (!draft.mandateId || !draft.realityProjectionId || !draft.evaluatorVersion) {
    throw new Error("PROTECTIVE_TRIGGER_PROOF_INCOMPLETE");
  }
  if (new Date(draft.observedAtUtc).toISOString() !== draft.observedAtUtc) {
    throw new Error("PROTECTIVE_TRIGGER_PROOF_INVALID_TIME");
  }
  const body = { schemaVersion: "waia.trader.protective_trigger_proof.v2" as const, ...draft, triggered: true as const };
  return Object.freeze({ ...body, contentDigest: createHash("sha256").update(canonicalizeSemanticJsonString(body)).digest("hex") });
}

export function assertProtectiveTriggerProofV2(value: ProtectiveTriggerProofV2): void {
  const { contentDigest, ...draft } = value;
  const { schemaVersion, triggered, ...body } = draft;
  if (schemaVersion !== "waia.trader.protective_trigger_proof.v2" || triggered !== true) {
    throw new Error("PROTECTIVE_TRIGGER_PROOF_INVALID");
  }
  if (buildProtectiveTriggerProofV2(body).contentDigest !== contentDigest) {
    throw new Error("PROTECTIVE_TRIGGER_PROOF_DIGEST_MISMATCH");
  }
}
