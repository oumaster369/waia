import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();
import { APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST, SAVED_DOMAIN_APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST,
  APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST } from "./computation-manifest";
import { COMPUTATION_SOURCE_MANIFEST_DIGEST } from "../research-understanding-v1/computation-manifest";
import { requireApplication as check, type ResearchApplicationConfigurationV1 } from "./contract";
import type { ApplicationRow } from "./bounded-read-postgres";

/** Exact accepted828 profile only; never used to declare a newly executed command. */
const historical828 = "5070c0aa8e42824892dd2915c5d70b21cac4e9a22aec5947a7255d62a3d8faf2";
const pureApplication828 = "fbbeb707fe792747e88ad5e76782651f40fa7fd9351a6b47b2af83cf09bb8bb8";
const pureUnderstanding828 = "abb0618c8dc0298376fe7513c184d6c20f67aa93551caadfb1febf4f3de9f3b4";
export const CURRENT_LEGACY_APPLICATION_COMMAND = APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST;
export const CURRENT_SAVED_APPLICATION_COMMAND = SAVED_DOMAIN_APPLICATION_COMMAND_SOURCE_MANIFEST_DIGEST;

/** Stored metadata is authoritative only after the actual bounded read/hash
 * checks. This admits one fixed representation; it never grants write authority
 * or accepts a caller-selected profile/evaluator. Each parent/child is selected separately. */
export function storedApplicationCommandProfile(row: ApplicationRow, body: unknown, configuration: ResearchApplicationConfigurationV1): string {
  check(row.ownershipDomain === "CAPITAL_LEGACY_V2" || row.ownershipDomain === "SAVED_RESEARCH_V1", "APPLICATION_STORED_DOMAIN_INVALID");
  check(body !== null && typeof body === "object" && !Array.isArray(body) && "commandManifestDigest" in body &&
    typeof body.commandManifestDigest === "string" && /^[0-9a-f]{64}$/.test(body.commandManifestDigest), "APPLICATION_COMMAND_PROFILE_INVALID");
  const selected = body.commandManifestDigest;
  check(configuration.applicationComputationManifestDigest === APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST &&
    configuration.computationManifestDigest === COMPUTATION_SOURCE_MANIFEST_DIGEST, "APPLICATION_PURE_PROFILE_CONFLICT");
  if (selected === historical828) {
    check(row.ownershipDomain === "CAPITAL_LEGACY_V2" && APPLICATION_COMPUTATION_SOURCE_MANIFEST_DIGEST === pureApplication828 &&
      COMPUTATION_SOURCE_MANIFEST_DIGEST === pureUnderstanding828, "APPLICATION_HISTORICAL_PROFILE_REFUSED");
  } else check(selected === (row.ownershipDomain === "CAPITAL_LEGACY_V2" ? CURRENT_LEGACY_APPLICATION_COMMAND : CURRENT_SAVED_APPLICATION_COMMAND),
    "APPLICATION_COMMAND_PROFILE_UNADMITTED");
  return selected;
}
