import { enforceServerOnly } from "@/lib/enforce-server-only";
enforceServerOnly();

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { RESEARCH_EXECUTABLE_ID_V1 } from "@/lib/trader/research/research-experiment-contract-v1";

export const RESEARCH_EXECUTABLE_RUNTIME_IDENTITY_V1 =
  "waia.research.executable-release-identity.v1" as const;

/** The deployment owner supplies the actual release, following the canonical
 * verifier's existing trust convention. This is a versioned release assertion,
 * not a measurement of source files, scientific admission or capital authority.
 * No proposal, environment object or caller-provided observed digest is accepted. */
export function resolveCurrentResearchExecutableIdentityV1() {
  const waia = process.env.WAIA_RELEASE_SHA?.toLowerCase();
  const vercel = process.env.VERCEL_GIT_COMMIT_SHA?.toLowerCase();
  if (waia && vercel && waia !== vercel) {
    throw new Error("RESEARCH_EXECUTABLE_RELEASE_SHA_CONFLICT");
  }
  const releaseSha = waia ?? vercel ?? "";
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    throw new Error("RESEARCH_EXECUTABLE_RELEASE_SHA_MISSING_OR_INVALID");
  }
  const body = Object.freeze({
    schemaVersion: RESEARCH_EXECUTABLE_RUNTIME_IDENTITY_V1,
    authority: "TRUSTED_DEPLOYMENT_RELEASE_ASSERTION_ONLY" as const,
    releaseSha,
    executableId: RESEARCH_EXECUTABLE_ID_V1,
    featureSemantics: "closed-prefix-sma-population-zscore/v1" as const,
    replaySemantics: "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1" as const,
  });
  return Object.freeze({ ...body, sourceSha256: computeStableJsonDigest(body) });
}
