import { computeStableJsonDigest } from "@/lib/trader/research/digest";

/** Identity for NEW rows only. Existing persisted IDs are never rewritten. */
export function historicalDatasetRegistrationIdentityV2(input: Readonly<{
  organizationId: string; runId: string; cycleId: string; authorityContentDigestHex: string;
}>): string {
  const { organizationId, runId, cycleId, authorityContentDigestHex } = input;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(organizationId) ||
      ![runId, cycleId].every(value => typeof value === "string" && value.length > 0 &&
        value.trim() === value && !value.includes("\0")) || !/^[a-f0-9]{64}$/.test(authorityContentDigestHex)) {
    throw new Error("HISTORICAL_DATASET_REGISTRATION_IDENTITY_INVALID");
  }
  const digest = computeStableJsonDigest({
    namespace: "waia.trader.historical_dataset_registration_identity.v2",
    organizationId, runId, cycleId, authorityContentDigestHex,
  });
  // Same SHA256-derived UUID layout as canonical PIT identity. The complete
  // authority digest remains stored and independently checked on conflicts.
  const chars = digest.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16]!, 16) & 3) | 8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
