import { createHash } from "node:crypto";

import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";

export type ProtectiveMandateConsumptionV2 = Readonly<{
  schemaVersion: "waia.trader.protective_mandate_consumption.v2";
  organizationId: string;
  mandateId: string;
  mandateContentDigest: string;
  triggerProofContentDigest: string;
  adjudicatedAtUtc: string;
  contentDigest: string;
}>;

export interface ProtectiveMandateConsumptionRepositoryV2 {
  claimOnce(value: ProtectiveMandateConsumptionV2): Promise<"CLAIMED" | "ALREADY_CONSUMED">;
}

const DIGEST = /^[0-9a-f]{64}$/;

export function buildProtectiveMandateConsumptionV2(input: Omit<ProtectiveMandateConsumptionV2, "schemaVersion" | "contentDigest">): ProtectiveMandateConsumptionV2 {
  if (!input.organizationId || !input.mandateId) throw new Error("GUARDIAN_PROTECTIVE_CONSUMPTION_INCOMPLETE");
  if (!DIGEST.test(input.mandateContentDigest) || !DIGEST.test(input.triggerProofContentDigest)) {
    throw new Error("GUARDIAN_PROTECTIVE_CONSUMPTION_INVALID_DIGEST");
  }
  if (new Date(input.adjudicatedAtUtc).toISOString() !== input.adjudicatedAtUtc) {
    throw new Error("GUARDIAN_PROTECTIVE_CONSUMPTION_INVALID_TIME");
  }
  const body = { schemaVersion: "waia.trader.protective_mandate_consumption.v2" as const, ...input };
  return Object.freeze({ ...body, contentDigest: createHash("sha256").update(canonicalizeSemanticJsonString(body)).digest("hex") });
}

export function createInMemoryProtectiveMandateConsumptionRepositoryV2(): ProtectiveMandateConsumptionRepositoryV2 {
  const consumed = new Set<string>();
  return {
    async claimOnce(value) {
      const key = `${value.organizationId}\0${value.mandateId}`;
      if (consumed.has(key)) return "ALREADY_CONSUMED";
      consumed.add(key);
      return "CLAIMED";
    },
  };
}
