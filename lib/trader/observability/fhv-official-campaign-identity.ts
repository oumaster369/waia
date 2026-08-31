import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";

export const FHV_OFFICIAL_CAMPAIGN_IDENTITY_FILENAME = "fhv-official-campaign-identity.v1.json";
export type FhvOfficialCampaignIdentityV1 = Readonly<{
  schemaVersion: "fhv-official-campaign-identity/v1";
  executionPurpose: "CONTROL_REPLAY";
  releaseSha: string;
  runId: string;
  organizationId: string;
  launchReceiptDigest: string;
  identityDigest: string;
}>;

export function writeFhvOfficialCampaignIdentity(
  input: Omit<
    FhvOfficialCampaignIdentityV1,
    "schemaVersion" | "executionPurpose" | "identityDigest"
  > & { runDir: string },
): FhvOfficialCampaignIdentityV1 {
  const { runDir, ...identity } = input;
  const body = {
    schemaVersion: "fhv-official-campaign-identity/v1" as const,
    executionPurpose: "CONTROL_REPLAY" as const,
    ...identity,
  };
  const receipt = { ...body, identityDigest: computePayloadDigest(body) };
  writeFileAtomicExclusive(
    join(runDir, FHV_OFFICIAL_CAMPAIGN_IDENTITY_FILENAME),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  return receipt;
}

export function readFhvOfficialCampaignIdentity(runDir: string): FhvOfficialCampaignIdentityV1 {
  const parsed = JSON.parse(
    readFileSync(join(runDir, FHV_OFFICIAL_CAMPAIGN_IDENTITY_FILENAME), "utf8"),
  ) as FhvOfficialCampaignIdentityV1;
  const { identityDigest, ...body } = parsed;
  if (
    parsed.schemaVersion !== "fhv-official-campaign-identity/v1" ||
    parsed.executionPurpose !== "CONTROL_REPLAY" ||
    computePayloadDigest(body) !== identityDigest
  )
    throw new Error("OFFICIAL_CAMPAIGN_IDENTITY_INVALID");
  return parsed;
}
