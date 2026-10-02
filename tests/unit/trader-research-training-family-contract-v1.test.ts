import { afterEach, describe, expect, it } from "vitest";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
} from "@/lib/trader/research/research-development-source-contract-v1";
import {
  researchExperimentIdentityV1,
} from "@/lib/trader/research/research-experiment-contract-v1";
import {
  buildResearchTrainingFamilyReceiptV1,
  captureResearchTrainingFamilyRequestV1,
  requireCanonicalResearchSelectionDecimalV1,
} from "@/lib/trader/research/research-training-family-contract-v1";
import { resolveCurrentResearchExecutableIdentityV1 } from "@/lib/trader/research/research-executable-runtime-identity-v1";
import { buildResearchExperimentProposalV1 } from "@/tests/helpers/research-experiment-fixture";

const ATTEMPT_ID = "a0000000-0000-4000-8000-000000012222";
const priorReleaseSha = process.env.WAIA_RELEASE_SHA;
const priorVercelSha = process.env.VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (priorReleaseSha === undefined) delete process.env.WAIA_RELEASE_SHA;
  else process.env.WAIA_RELEASE_SHA = priorReleaseSha;
  if (priorVercelSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = priorVercelSha;
});

function getSpec() {
  const proposal = buildResearchExperimentProposalV1(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, "family-contract");
  return researchExperimentIdentityV1(proposal);
}

function requestInput() {
  return {
    organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
    attemptId: ATTEMPT_ID,
    limits: { maxBars: 4096, maxBytes: 32 * 1024 * 1024, maxTraceBytes: 32 * 1024 * 1024 },
  };
}

function summaries(netValues: string[]) {
  return netValues.map((netRealizedPnl, trialIndex) => ({
    trialIndex,
    stageRunId: `b0000000-0000-4000-8000-${String(trialIndex + 1).padStart(12, "0")}`,
    traceSha256: String(trialIndex + 1).repeat(64),
    scopeDigestHex: "a".repeat(64),
    ledgerDigestHex: "b".repeat(64),
    finalAccountingDigestHex: "c".repeat(64),
    netRealizedPnl,
    orderCount: trialIndex,
    fillCount: trialIndex,
  }));
}

function buildReceipt(netValues: string[]) {
  const experiment = getSpec();
  process.env.WAIA_RELEASE_SHA = "d".repeat(40);
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  return buildResearchTrainingFamilyReceiptV1({
    organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
    attemptId: ATTEMPT_ID,
    spec: experiment.spec,
    experimentSpecSha256: experiment.specSha256,
    sourceRunId: "synthetic-source-run",
    sourceIssuanceDigest: "e".repeat(64),
    policyDigestHex: "f".repeat(64),
    observedExecutableIdentity: resolveCurrentResearchExecutableIdentityV1(),
    trials: summaries(netValues),
  });
}

describe("research training family contract v1", () => {
  it("captures only the fixed DEVELOPMENT org and detaches/freezes bounded request fields", () => {
    const input: { organizationId: string; attemptId: string;
      limits: { maxBars: number; maxBytes: number; maxTraceBytes: number } } = requestInput();
    input.organizationId = input.organizationId.toUpperCase();
    const captured = captureResearchTrainingFamilyRequestV1(input);

    expect(captured.organizationId).toBe(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
    expect(captured.attemptId).toBe(ATTEMPT_ID);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.limits)).toBe(true);
    input.attemptId = "a0000000-0000-4000-8000-000000012223";
    input.limits.maxBars = 1;
    expect(captured.attemptId).toBe(ATTEMPT_ID);
    expect(captured.limits.maxBars).toBe(4096);
    expect(Reflect.set(captured.limits, "maxBars", 1)).toBe(false);
  });

  it("rejects authority fields, unknown keys, non-Org0 IDs, and malformed identifiers", () => {
    const forgedAuthority = { ...requestInput(), authority: "VERIFIED", scorer: () => 1 };
    expect(() => captureResearchTrainingFamilyRequestV1(forgedAuthority)).toThrow();

    const nestedUnknown = requestInput() as Record<string, unknown>;
    nestedUnknown.limits = { maxBars: 10, maxBytes: 100, maxTraceBytes: 100, result: "winner" };
    expect(() => captureResearchTrainingFamilyRequestV1(nestedUnknown)).toThrow();

    expect(() => captureResearchTrainingFamilyRequestV1({
      ...requestInput(), organizationId: "a0000000-0000-4000-8000-000000000001",
    })).toThrow();
    expect(() => captureResearchTrainingFamilyRequestV1({ ...requestInput(), attemptId: "not-a-uuid" })).toThrow();
  });

  it("enforces inclusive request budget bounds", () => {
    const atMinimums = requestInput();
    atMinimums.limits = { maxBars: 1, maxBytes: 1, maxTraceBytes: 1 };
    expect(captureResearchTrainingFamilyRequestV1(atMinimums).limits).toEqual(atMinimums.limits);

    for (const limits of [
      { maxBars: 0, maxBytes: 1, maxTraceBytes: 1 },
      { maxBars: 4097, maxBytes: 1, maxTraceBytes: 1 },
      { maxBars: 1, maxBytes: 0, maxTraceBytes: 1 },
      { maxBars: 1, maxBytes: 32 * 1024 * 1024 + 1, maxTraceBytes: 1 },
      { maxBars: 1, maxBytes: 1, maxTraceBytes: 32 * 1024 * 1024 + 1 },
      { maxBars: 1.5, maxBytes: 1, maxTraceBytes: 1 },
    ]) {
      expect(() => captureResearchTrainingFamilyRequestV1({ ...requestInput(), limits })).toThrow();
    }
  });

  it("accepts canonical signed decimal strings and refuses noncanonical or over-precision metrics", () => {
    for (const value of ["0", "1", "-1", "0.00000001", "-9007199254740992.12345678"]) {
      expect(requireCanonicalResearchSelectionDecimalV1(value)).toBe(value);
    }
    for (const value of ["-0", "01", "+1", ".5", "1.0", "1.000000000", " 1", "1e3", 1, null]) {
      expect(() => requireCanonicalResearchSelectionDecimalV1(value)).toThrow();
    }
  });

  it("requires the complete ordered family and matching registered-spec digest", () => {
    const experiment = getSpec();
    process.env.WAIA_RELEASE_SHA = "d".repeat(40);
    const base = {
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId: ATTEMPT_ID,
      spec: experiment.spec,
      experimentSpecSha256: experiment.specSha256,
      sourceRunId: "synthetic-source-run",
      sourceIssuanceDigest: "e".repeat(64),
      policyDigestHex: "f".repeat(64),
      observedExecutableIdentity: resolveCurrentResearchExecutableIdentityV1(),
    };
    expect(() => buildResearchTrainingFamilyReceiptV1({ ...base, trials: summaries(["1", "2"]) })).toThrow(/FAMILY_IDENTITY/);
    expect(() => buildResearchTrainingFamilyReceiptV1({
      ...base, experimentSpecSha256: "0".repeat(64), trials: summaries(["1", "2", "3"]),
    })).toThrow(/FAMILY_IDENTITY/);

    const reordered = summaries(["1", "2", "3"]);
    [reordered[0]!.trialIndex, reordered[1]!.trialIndex] = [1, 0];
    expect(() => buildResearchTrainingFamilyReceiptV1({ ...base, trials: reordered })).toThrow(/TRIAL_IDENTITY/);
  });

  it("ranks exact eight-decimal values beyond JavaScript Number precision", () => {
    const lower = "9007199254740992.00000001";
    const higher = "9007199254740992.00000002";
    expect(Number(lower)).toBe(Number(higher));
    const receipt = buildReceipt([lower, higher, "9007199254740992"]);
    expect(receipt.selectedIndex).toBe(1);
    expect(receipt.selectedParameters).toEqual(getSpec().spec.orderedTrials[1]);
  });

  it("uses first-declared tie-break and selects correctly when all results are negative or zero", () => {
    expect(buildReceipt(["-1", "-2", "-1"]).selectedIndex).toBe(0);
    expect(buildReceipt(["0", "0", "0"]).selectedIndex).toBe(0);
    expect(buildReceipt(["-3", "-1", "-2"]).selectedIndex).toBe(1);
  });

  it("retains every ordered result, including negative and zero-trade trials, with frozen parameter copies", () => {
    const trialRows = summaries(["-4", "0", "-2"]);
    const receipt = buildReceipt(trialRows.map(row => row.netRealizedPnl));
    expect(receipt.trials.map(row => [row.trialIndex, row.netRealizedPnl, row.orderCount, row.fillCount])).toEqual([
      [0, "-4", 0, 0], [1, "0", 1, 1], [2, "-2", 2, 2],
    ]);
    expect(receipt.trials.map(row => row.parameters.lookbackBars)).toEqual([8, 16, 32]);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.trials)).toBe(true);
    expect(Object.isFrozen(receipt.trials[0]!.parameters)).toBe(true);
    expect(Reflect.set(receipt.trials[0]!.parameters, "lookbackBars", 64)).toBe(false);
    expect(receipt.scientificQualified).toBe(false);
    expect(receipt.capitalEligible).toBe(false);
    expect(receipt.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    const { contentDigest, ...body } = receipt;
    expect(contentDigest).toBe(computeStableJsonDigest(body));
  });
});
