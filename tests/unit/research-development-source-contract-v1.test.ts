import { describe, expect, it } from "vitest";

import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  captureResearchDevelopmentSourceRequestV1,
  RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
  researchDevelopmentSourceRunIdV1,
  sealResearchDevelopmentSourceIssuanceV1,
  parseResearchDevelopmentSourceIssuanceV1,
  type ResearchDevelopmentSourceBodyV1,
} from "@/lib/trader/research/research-development-source-contract-v1";

const RELEASE = "a".repeat(40);
const OTHER_RELEASE = "b".repeat(40);
const SHA = "c".repeat(64);
const BASE_MS = Date.parse("2020-01-01T00:00:00.000Z");

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
    commandId: "source-run:unit-01",
    symbol: "BTCUSDT",
    initialRecordIndex: 100,
    observationBarCount: 2,
    gapBarCount: 1,
    trainingBarCount: 3,
    ...overrides,
  };
}

function bodyInput(overrides: Partial<ResearchDevelopmentSourceBodyV1> = {}): ResearchDevelopmentSourceBodyV1 {
  const request = captureResearchDevelopmentSourceRequestV1(requestInput());
  const observationFirst = BASE_MS + request.initialRecordIndex * 60_000;
  const observationLastClose = observationFirst + request.observationBarCount * 60_000;
  const trainingFirst = observationLastClose + request.gapBarCount * 60_000;
  return {
    schemaVersion: "waia.research.development-source-issuance.v1",
    authority: "RESTRICTED_DEVELOPMENT_SOURCE_WRITER_V1",
    request,
    sourceRunId: researchDevelopmentSourceRunIdV1(request),
    releaseSha: RELEASE,
    sourceReleaseSha: RELEASE,
    qualificationReceiptDigest: SHA,
    runtimeRequalificationDigest: null,
    partitionRawSha256: SHA,
    partitionSemanticDigest: "d".repeat(64),
    volumeQualificationDigest: "e".repeat(64),
    rowSetSha256: "f".repeat(64),
    observation: {
      firstRecordIndex: request.initialRecordIndex,
      barCount: request.observationBarCount,
      firstOpenMs: observationFirst,
      lastCloseMs: observationLastClose,
      contentSha256: "1".repeat(64),
    },
    training: {
      firstRecordIndex: request.initialRecordIndex + request.observationBarCount + request.gapBarCount,
      barCount: request.trainingBarCount,
      firstOpenMs: trainingFirst,
      lastCloseMs: trainingFirst + request.trainingBarCount * 60_000,
      contentSha256: "2".repeat(64),
    },
    pitRule: "CLOSED_BAR_AND_ABSOLUTE_RECORD_INDEX_ONLY",
    sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
    scientificallyQualified: false,
    capitalEligible: false,
    issuerRole: "waia_research_source_writer",
    issuedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function digestBody(body: ResearchDevelopmentSourceBodyV1) {
  return { ...body, contentDigest: computeStableJsonDigest(body) };
}

describe("DEE-1211 DEVELOPMENT source contract v1", () => {
  it("captures only the fixed research organization and detaches scalar request input", () => {
    const source = requestInput();
    const captured = captureResearchDevelopmentSourceRequestV1(source);
    source.commandId = "mutated-after-capture";
    source.initialRecordIndex = 999;

    expect(captured.organizationId).toBe(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
    expect(captured.commandId).toBe("source-run:unit-01");
    expect(captured.initialRecordIndex).toBe(100);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(researchDevelopmentSourceRunIdV1(captured)).toMatch(/^research-source-v1:[a-f0-9]{64}$/);
  });

  it.each([
    ["foreign organization", requestInput({ organizationId: "4c50b4e9-1138-43a5-a29f-e65088124cfc" })],
    ["unsupported symbol", requestInput({ symbol: "SOLUSDT" })],
    ["unknown request field", requestInput({ sourceRunId: "caller-selected" })],
    ["command with whitespace", requestInput({ commandId: "source run" })],
    ["command with terminal newline", requestInput({ commandId: "source-run\n" })],
    ["empty command", requestInput({ commandId: "" })],
  ])("rejects %s", (_label, value) => {
    expect(() => captureResearchDevelopmentSourceRequestV1(value)).toThrow();
  });

  it("accepts the maximum bounded materialization and rejects larger or unsafe ranges", () => {
    expect(() => captureResearchDevelopmentSourceRequestV1(requestInput({
      initialRecordIndex: 0,
      observationBarCount: 3_332,
      gapBarCount: 3_333,
      trainingBarCount: 3_335,
    }))).not.toThrow();
    expect(() => captureResearchDevelopmentSourceRequestV1(requestInput({
      observationBarCount: 3_333,
      gapBarCount: 3_333,
      trainingBarCount: 3_335,
    }))).toThrow();
    expect(() => captureResearchDevelopmentSourceRequestV1(requestInput({
      initialRecordIndex: Number.MAX_SAFE_INTEGER,
      observationBarCount: 2,
    }))).toThrow();
    expect(() => captureResearchDevelopmentSourceRequestV1(requestInput({
      initialRecordIndex: Number.MAX_SAFE_INTEGER + 1,
    }))).toThrow();
    expect(() => captureResearchDevelopmentSourceRequestV1(requestInput({
      observationBarCount: 0,
    }))).toThrow();
  });

  it("seals and parses an exact issuance while returning detached frozen nested records", () => {
    const original = bodyInput();
    const sealed = sealResearchDevelopmentSourceIssuanceV1(original);
    const parsed = parseResearchDevelopmentSourceIssuanceV1(sealed);

    expect(parsed).toEqual(sealed);
    expect(parsed.contentDigest).toBe(computeStableJsonDigest(original));
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.request)).toBe(true);
    expect(Object.isFrozen(parsed.observation)).toBe(true);
    expect(Object.isFrozen(parsed.training)).toBe(true);
  });

  it("accepts a release change only when a runtime requalification digest is bound", () => {
    const body = {
      ...bodyInput(),
      releaseSha: OTHER_RELEASE,
      runtimeRequalificationDigest: SHA,
    };
    expect(sealResearchDevelopmentSourceIssuanceV1(body).releaseSha).toBe(OTHER_RELEASE);
  });

  it("rejects digest tampering, unsupported schema, and extra closed-contract fields", () => {
    const sealed = sealResearchDevelopmentSourceIssuanceV1(bodyInput());
    expect(() => parseResearchDevelopmentSourceIssuanceV1({
      ...sealed,
      partitionRawSha256: "9".repeat(64),
    })).toThrow(/ISSUANCE_DIGEST_MISMATCH/);
    expect(() => parseResearchDevelopmentSourceIssuanceV1({
      ...sealed,
      schemaVersion: "waia.research.development-source-issuance.v2",
    })).toThrow();
    expect(() => parseResearchDevelopmentSourceIssuanceV1({
      ...sealed,
      unrecognized: true,
    })).toThrow();
    expect(() => sealResearchDevelopmentSourceIssuanceV1({
      ...bodyInput(),
      training: { ...bodyInput().training, extra: "not permitted" },
    } as never)).toThrow();
  });

  it.each([
    ["invalid calendar date", "2026-02-30T00:00:00.000Z"],
    ["timezone offset", "2026-01-01T01:00:00.000+01:00"],
    ["missing UTC marker", "2026-01-01T00:00:00.000"],
  ])("rejects noncanonical issuedAt (%s)", (_label, issuedAt) => {
    expect(() => sealResearchDevelopmentSourceIssuanceV1({
      ...bodyInput(),
      issuedAt,
    } as never)).toThrow();
    const invalid = { ...bodyInput(), issuedAt };
    expect(() => parseResearchDevelopmentSourceIssuanceV1(digestBody(invalid as never))).toThrow();
  });

  it.each([
    ["run id does not bind the captured command", { sourceRunId: "research-source-v1:" + "0".repeat(64) }],
    ["observation starts at another absolute index", {
      observation: { ...bodyInput().observation, firstRecordIndex: 99 },
    }],
    ["observation count differs from request", {
      observation: { ...bodyInput().observation, barCount: 1 },
    }],
    ["training begins before the declared gap", {
      training: { ...bodyInput().training, firstRecordIndex: 102, firstOpenMs: BASE_MS + 102 * 60_000 },
    }],
    ["training count differs from request", {
      training: { ...bodyInput().training, barCount: 2 },
    }],
    ["training interval violates the gap", {
      training: { ...bodyInput().training, firstOpenMs: BASE_MS + 104 * 60_000 },
    }],
    ["source and runtime release disagree without requalification", {
      releaseSha: OTHER_RELEASE,
    }],
    ["source and runtime release differ but have no runtime receipt digest", {
      releaseSha: OTHER_RELEASE,
      runtimeRequalificationDigest: null,
    }],
    ["same release carries unnecessary runtime receipt identity", {
      runtimeRequalificationDigest: SHA,
    }],
  ])("rejects issuance when %s", (_label, overrides) => {
    expect(() => sealResearchDevelopmentSourceIssuanceV1({
      ...bodyInput(),
      ...overrides,
    } as never)).toThrow();
  });

  it("does not retain caller-owned nested request or split objects", () => {
    const input = bodyInput();
    const mutable = {
      ...input,
      request: { ...input.request },
      observation: { ...input.observation },
      training: { ...input.training },
    };
    const sealed = sealResearchDevelopmentSourceIssuanceV1(mutable as never);
    mutable.request.commandId = "changed";
    mutable.observation.firstRecordIndex = 900;
    mutable.training.contentSha256 = "9".repeat(64);

    expect(sealed.request.commandId).toBe("source-run:unit-01");
    expect(sealed.observation.firstRecordIndex).toBe(100);
    expect(sealed.training.contentSha256).toBe("2".repeat(64));
  });
});
