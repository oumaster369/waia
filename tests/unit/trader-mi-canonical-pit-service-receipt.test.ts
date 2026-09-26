import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-repository-postgres";
import { hasCanonicalGatewayPitReceiptContentV1, type CanonicalGatewayPitReceiptV1 } from "@/lib/trader/mi/canonical-pit-service-postgres";
import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";

function receipt(status: CanonicalGatewayPitReceiptV1["status"] = "AVAILABLE") {
  return buildCanonicalGatewayPitReceiptV1({
    organizationId: "11111111-1111-4111-8111-111111111111",
    providerId: "htx_spot", gatewayKind: "quote_l1", status,
    reason: status === "AVAILABLE" ? null : "SOURCE_UNKNOWN",
    sourceId: status === "AVAILABLE" ? "22222222-2222-4222-8222-222222222222" : null,
    trustAsOfReceiptId: status === "AVAILABLE" ? "a".repeat(64) : null,
    observationId: status === "AVAILABLE" ? "33333333-3333-4333-8333-333333333333" : null,
    observationContentDigest: status === "AVAILABLE" ? "b".repeat(64) : null,
    normalizedInputDigest: "c".repeat(64),
  });
}
function oldContentCheck(value: CanonicalGatewayPitReceiptV1): boolean {
  const digest = (body: unknown) => createHash("sha256").update(canonicalJsonString(body)).digest("hex");
  return digest(buildCanonicalGatewayPitReceiptV1(value)) === digest(value);
}
function outcome(check: (value: CanonicalGatewayPitReceiptV1) => boolean, value: CanonicalGatewayPitReceiptV1) {
  try { return { value: check(value) }; }
  catch (error) { return { error: (error as Error).message, name: (error as Error).name }; }
}

describe("DEE1121 canonical service receipt content consistency", () => {
  it.each(["AVAILABLE", "REJECTED", "UNAVAILABLE"] as const)("preserves exact %s bodies without modification", status => {
    const value = receipt(status); const before = structuredClone(value);
    expect(hasCanonicalGatewayPitReceiptContentV1(value)).toBe(true);
    expect(outcome(hasCanonicalGatewayPitReceiptContentV1, value)).toEqual(outcome(oldContentCheck, value));
    expect(value).toEqual(before);
  });
  it.each(["id", "schema", "digest", "input", "observation", "trust", "provider", "kind", "status", "organization", "extra", "missing", "invalid-uuid", "invalid-digest", "missing-available-observation"])(
    "preserves old mismatch/exception behavior for %s", kind => {
      const value = receipt(); const fields = value as unknown as Record<string, unknown>;
      if (kind === "id") value.id = "d".repeat(64);
      if (kind === "schema") fields.schemaVersion = "other";
      if (kind === "digest") value.contentDigest = "d".repeat(64);
      if (kind === "input") value.normalizedInputDigest = "d".repeat(64);
      if (kind === "observation") value.observationContentDigest = "d".repeat(64);
      if (kind === "trust") value.trustAsOfReceiptId = "d".repeat(64);
      if (kind === "provider") value.providerId = "other";
      if (kind === "kind") value.gatewayKind = "other";
      if (kind === "status") value.status = "REJECTED";
      if (kind === "organization") value.organizationId = "44444444-4444-4444-8444-444444444444";
      if (kind === "extra") fields.extra = true;
      if (kind === "missing") delete fields.schemaVersion;
      if (kind === "invalid-uuid") value.organizationId = "invalid";
      if (kind === "invalid-digest") value.normalizedInputDigest = "invalid";
      if (kind === "missing-available-observation") value.observationId = null;
      const actual = outcome(hasCanonicalGatewayPitReceiptContentV1, value);
      expect(actual).toEqual(outcome(oldContentCheck, value));
      expect(actual).not.toEqual({ value: true });
    },
  );
  it("does not authenticate a newly sealed receipt or decide its tenant or persisted existence", () => {
    const value = buildCanonicalGatewayPitReceiptV1({ ...receipt(), organizationId: "44444444-4444-4444-8444-444444444444" });
    // No database/source port is called: the owner must independently verify durable scope and bodies.
    expect(hasCanonicalGatewayPitReceiptContentV1(value)).toBe(true);
  });
});
