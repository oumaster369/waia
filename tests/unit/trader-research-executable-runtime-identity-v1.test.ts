import { afterEach, describe, expect, it } from "vitest";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { RESEARCH_EXECUTABLE_ID_V1 } from "@/lib/trader/research/research-experiment-contract-v1";
import {
  RESEARCH_EXECUTABLE_RUNTIME_IDENTITY_V1,
  resolveCurrentResearchExecutableIdentityV1,
} from "@/lib/trader/research/research-executable-runtime-identity-v1";

const priorWaiaReleaseSha = process.env.WAIA_RELEASE_SHA;
const priorVercelCommitSha = process.env.VERCEL_GIT_COMMIT_SHA;

function setRelease(waia: string | undefined, vercel: string | undefined) {
  if (waia === undefined) delete process.env.WAIA_RELEASE_SHA;
  else process.env.WAIA_RELEASE_SHA = waia;
  if (vercel === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = vercel;
}

afterEach(() => setRelease(priorWaiaReleaseSha, priorVercelCommitSha));

describe("resolveCurrentResearchExecutableIdentityV1", () => {
  it("fails closed when the trusted release assertion is missing, malformed, or conflicting", () => {
    setRelease(undefined, undefined);
    expect(() => resolveCurrentResearchExecutableIdentityV1())
      .toThrow("RESEARCH_EXECUTABLE_RELEASE_SHA_MISSING_OR_INVALID");

    setRelease("", "a".repeat(40));
    expect(() => resolveCurrentResearchExecutableIdentityV1())
      .toThrow("RESEARCH_EXECUTABLE_RELEASE_SHA_MISSING_OR_INVALID");

    for (const malformed of ["f".repeat(39), "f".repeat(41), "F".repeat(39), `a${"b".repeat(39)}\n`]) {
      setRelease(malformed, undefined);
      expect(() => resolveCurrentResearchExecutableIdentityV1())
        .toThrow("RESEARCH_EXECUTABLE_RELEASE_SHA_MISSING_OR_INVALID");
    }

    setRelease("a".repeat(40), "b".repeat(40));
    expect(() => resolveCurrentResearchExecutableIdentityV1())
      .toThrow("RESEARCH_EXECUTABLE_RELEASE_SHA_CONFLICT");
  });

  it("accepts matching case-insensitive full release SHAs and binds the closed descriptor", () => {
    const releaseSha = "aB12" + "cD34".repeat(9);
    const normalized = releaseSha.toLowerCase();
    setRelease(releaseSha, normalized.toUpperCase());

    const identity = resolveCurrentResearchExecutableIdentityV1();
    const { sourceSha256, ...body } = identity;

    expect(sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(identity).toEqual({
      schemaVersion: RESEARCH_EXECUTABLE_RUNTIME_IDENTITY_V1,
      authority: "TRUSTED_DEPLOYMENT_RELEASE_ASSERTION_ONLY",
      releaseSha: normalized,
      executableId: RESEARCH_EXECUTABLE_ID_V1,
      featureSemantics: "closed-prefix-sma-population-zscore/v1",
      replaySemantics: "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1",
      sourceSha256: computeStableJsonDigest(body),
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(Reflect.set(identity, "releaseSha", "f".repeat(40))).toBe(false);
    expect(resolveCurrentResearchExecutableIdentityV1()).toEqual(identity);
  });

  it("changes identity when the release changes without accepting caller-supplied identity", () => {
    setRelease("1".repeat(40), undefined);
    const first = resolveCurrentResearchExecutableIdentityV1();
    setRelease(undefined, "2".repeat(40));
    const second = resolveCurrentResearchExecutableIdentityV1();

    expect(first.releaseSha).toBe("1".repeat(40));
    expect(second.releaseSha).toBe("2".repeat(40));
    expect(first.sourceSha256).not.toBe(second.sourceSha256);
  });
});
