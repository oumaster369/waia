import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Bar } from "@/lib/trader/intelligence/types";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import { barToFhvBarsV2Record, serializeFhvBarsV2Record } from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { fhvOfficialPartitionFileRelativePath } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { loadHistoricalSimulationBootstrapSourceSnapshotV2 } from "@/lib/trader/historical-simulation-v2/bootstrap-source-loader-v2";
import { RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1 } from "@/lib/trader/research/research-development-source-contract-v1";
import { ZodError } from "zod";
import {
  captureResearchDevelopmentSourceRequestV1,
  researchDevelopmentSourceRunIdV1,
  sealResearchDevelopmentSourceIssuanceV1,
  type ResearchDevelopmentSourceBodyV1,
} from "@/lib/trader/research/research-development-source-contract-v1";
import {
  parseResearchDevelopmentEvaluationSourceMetadataV1,
} from "@/lib/trader/research/research-development-evaluation-source-contract-v1";
import { prepareResearchDevelopmentEvaluationSourceMetadataV1 } from "@/lib/trader/research/research-development-evaluation-source-snapshot-v1";
import { createResearchDevelopmentSourceFixtureV1, type ResearchDevelopmentSourceFixtureV1 } from "@/tests/helpers/research-development-source-fixture-v1";

const MINUTE_MS = 60_000;
const activeFixtures: ResearchDevelopmentSourceFixtureV1[] = [];

afterEach(() => {
  for (const fixture of activeFixtures.splice(0)) fixture.cleanup();
});

function fixture(): ResearchDevelopmentSourceFixtureV1 {
  const value = createResearchDevelopmentSourceFixtureV1({ barCount: 14 });
  activeFixtures.push(value);
  return value;
}

function host(source: ResearchDevelopmentSourceFixtureV1) {
  return {
    datasetRoot: source.datasetRoot,
    qualificationReceiptPath: source.qualificationReceiptPath,
    runtimeRequalificationReceiptPath: source.runtimeRequalificationReceiptPath,
    htxVolumeQualificationReceiptPath: source.htxVolumeQualificationReceiptPath,
    releaseSha: source.releaseSha,
  };
}

function currentQualification(source: ResearchDevelopmentSourceFixtureV1) {
  return JSON.parse(readFileSync(source.qualificationReceiptPath, "utf8")) as {
    releaseSha: string;
    qualificationReceiptDigest: string;
    partitions: Array<{ rawSha256: string; semanticContentDigest: string; barCount: number }>;
  };
}

/** Synthetic request/issuance metadata for this fixture only; never registered or persisted. */
function trainingIssuance(source: ResearchDevelopmentSourceFixtureV1, overrides: Partial<ResearchDevelopmentSourceBodyV1> = {}) {
  const sourceRequest = captureResearchDevelopmentSourceRequestV1({
    organizationId: source.organizationId,
    commandId: "synthetic-training-source",
    symbol: "BTCUSDT",
    initialRecordIndex: 0,
    observationBarCount: 2,
    gapBarCount: 1,
    trainingBarCount: 3,
  });
  const qualification = currentQualification(source);
  const raw = readFileSync(join(source.datasetRoot,
    fhvOfficialPartitionFileRelativePath({ partition: "development", symbol: "BTCUSDT" })));
  const partition = qualification.partitions[0]!;
  const observation = source.bars.slice(0, 2);
  const training = source.bars.slice(3, 6);
  const body: ResearchDevelopmentSourceBodyV1 = {
    schemaVersion: "waia.research.development-source-issuance.v1",
    authority: "RESTRICTED_DEVELOPMENT_SOURCE_WRITER_V1",
    request: sourceRequest,
    sourceRunId: researchDevelopmentSourceRunIdV1(sourceRequest),
    releaseSha: source.releaseSha,
    sourceReleaseSha: qualification.releaseSha,
    qualificationReceiptDigest: qualification.qualificationReceiptDigest,
    runtimeRequalificationDigest: null,
    partitionRawSha256: partition.rawSha256,
    partitionSemanticDigest: partition.semanticContentDigest,
    volumeQualificationDigest: source.volumeQualificationReceipt.qualificationReceiptDigest,
    // The fixture has no committed DB row set; this is only a syntactically valid synthetic binding.
    rowSetSha256: "f".repeat(64),
    observation: {
      firstRecordIndex: 0, barCount: observation.length,
      firstOpenMs: Date.parse(observation[0]!.barOpenTime),
      lastCloseMs: Date.parse(observation.at(-1)!.barCloseTime),
      contentSha256: computeBarSetDigest(observation),
    },
    training: {
      firstRecordIndex: 3, barCount: training.length,
      firstOpenMs: Date.parse(training[0]!.barOpenTime),
      lastCloseMs: Date.parse(training.at(-1)!.barCloseTime),
      contentSha256: computeBarSetDigest(training),
    },
    pitRule: "CLOSED_BAR_AND_ABSOLUTE_RECORD_INDEX_ONLY",
    sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
    scientificallyQualified: false,
    capitalEligible: false,
    issuerRole: "waia_research_source_writer",
    issuedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  // Keep a read of the current file in this builder to ensure each test's fixture path exists;
  // the loader itself still authenticates that file against the receipt on every call.
  expect(createHash("sha256").update(raw).digest("hex")).toBe(partition.rawSha256);
  return sealResearchDevelopmentSourceIssuanceV1(body);
}

function requestFor(source: ResearchDevelopmentSourceFixtureV1, issuance: ReturnType<typeof trainingIssuance>) {
  return {
    organizationId: source.organizationId,
    commandId: "synthetic-evaluation-source",
    trainingSourceRunId: issuance.sourceRunId,
    trainingSourceIssuanceDigest: issuance.contentDigest,
    symbol: "BTCUSDT",
    validation: { firstRecordIndex: 6, barCount: 6 },
    walkForward: [
      { firstRecordIndex: 6, barCount: 2 },
      { firstRecordIndex: 10, barCount: 2 },
    ],
  };
}

async function prepare(source: ResearchDevelopmentSourceFixtureV1,
  issuance = trainingIssuance(source), suppliedRequest: unknown = requestFor(source, issuance),
  suppliedHost = host(source), signal?: AbortSignal) {
  return prepareResearchDevelopmentEvaluationSourceMetadataV1({
    request: suppliedRequest, trainingIssuance: issuance, host: suppliedHost, signal,
  });
}

function rewriteFixture(source: ResearchDevelopmentSourceFixtureV1, bars: readonly Bar[]) {
  const filePath = join(source.datasetRoot,
    fhvOfficialPartitionFileRelativePath({ partition: "development", symbol: "BTCUSDT" }));
  const raw = Buffer.from(bars.map(bar => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join(""), "utf8");
  writeFileSync(filePath, raw);
  const receipt = JSON.parse(readFileSync(source.qualificationReceiptPath, "utf8")) as Record<string, unknown> & {
    partitions: Array<Record<string, unknown>>;
  };
  const evidence = receipt.partitions[0]!;
  evidence.rawSha256 = createHash("sha256").update(raw).digest("hex");
  evidence.semanticContentDigest = computeStableJsonDigest(bars);
  evidence.barCount = bars.length;
  evidence.expectedBarCount = bars.length;
  evidence.firstBarOpen = bars[0]!.barOpenTime;
  evidence.lastBarClose = bars.at(-1)!.barCloseTime;
  delete receipt.qualificationReceiptDigest;
  receipt.qualificationReceiptDigest = computeStableJsonDigest(receipt);
  writeFileSync(source.qualificationReceiptPath, `${JSON.stringify(receipt)}\n`);
}

function loadSyntheticSnapshot(source: ResearchDevelopmentSourceFixtureV1) {
  return loadHistoricalSimulationBootstrapSourceSnapshotV2({
    ...host(source),
    organizationId: source.organizationId,
    runId: "research-evaluation-source-v1:synthetic-loader-proof",
    partition: "DEVELOPMENT",
    symbol: "BTCUSDT",
    initialRecordIndex: 6,
    cycleCount: 6,
    maxSourceBytes: 1024 * 1024,
    maxReceiptBytes: RESEARCH_DEVELOPMENT_SOURCE_LIMITS_V1.maxReceiptBytes,
  });
}

describe("research DEVELOPMENT evaluation-source snapshot preparation", () => {
  it("returns only frozen metadata for exact absolute validation and WF record slices", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const metadata = await prepare(source, issuance);

    expect(metadata).toMatchObject({
      authority: "PREPARATION_METADATA_ONLY",
      sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
      scientificQualified: false,
      capitalEligible: false,
      validation: {
        firstRecordIndex: 6, barCount: 6,
        firstOpenMs: Date.parse(source.bars[6]!.barOpenTime),
        lastCloseMs: Date.parse(source.bars[11]!.barCloseTime),
        contentSha256: computeBarSetDigest(source.bars.slice(6, 12)),
      },
      walkForward: [
        { firstRecordIndex: 6, barCount: 2,
          firstOpenMs: Date.parse(source.bars[6]!.barOpenTime),
          lastCloseMs: Date.parse(source.bars[7]!.barCloseTime),
          contentSha256: computeBarSetDigest(source.bars.slice(6, 8)) },
        { firstRecordIndex: 10, barCount: 2,
          firstOpenMs: Date.parse(source.bars[10]!.barOpenTime),
          lastCloseMs: Date.parse(source.bars[11]!.barCloseTime),
          contentSha256: computeBarSetDigest(source.bars.slice(10, 12)) },
      ],
    });
    expect(metadata).not.toHaveProperty("bars");
    expect(metadata).not.toHaveProperty("cycles");
    expect(JSON.stringify(metadata)).not.toContain('"close"');
    expect(JSON.stringify(metadata)).not.toContain('"open"');
    expect(Object.isFrozen(metadata)).toBe(true);
    expect(Object.isFrozen(metadata.request)).toBe(true);
    expect(Object.isFrozen(metadata.request.validation)).toBe(true);
    expect(Object.isFrozen(metadata.request.walkForward)).toBe(true);
    expect(Object.isFrozen(metadata.request.walkForward[0])).toBe(true);

    const parsed = parseResearchDevelopmentEvaluationSourceMetadataV1(metadata);
    expect(parsed.authority).toBe("PREPARATION_METADATA_ONLY");
    expect(parsed).toEqual(metadata);
  });

  it("captures caller request and host values before asynchronous source loading", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const request = requestFor(source, issuance);
    const sourceHost = host(source);
    const pending = prepare(source, issuance, request, sourceHost);
    request.validation.firstRecordIndex = 7;
    request.walkForward[0]!.firstRecordIndex = 7;
    sourceHost.releaseSha = "e".repeat(40);

    const metadata = await pending;
    expect(metadata.request.validation.firstRecordIndex).toBe(6);
    expect(metadata.request.walkForward[0]!.firstRecordIndex).toBe(6);
    expect(metadata.releaseSha).toBe(source.releaseSha);
  });

  it.each([
    ["overlapping WF slices", (input: ReturnType<typeof requestFor>) => {
      input.walkForward = [{ firstRecordIndex: 6, barCount: 4 }, { firstRecordIndex: 9, barCount: 2 }];
    }],
    ["WF slice outside validation", (input: ReturnType<typeof requestFor>) => {
      input.walkForward = [{ firstRecordIndex: 6, barCount: 2 }, { firstRecordIndex: 11, barCount: 2 }];
    }],
    ["unsafe absolute extent", (input: ReturnType<typeof requestFor>) => {
      input.validation = { firstRecordIndex: Number.MAX_SAFE_INTEGER - 1, barCount: 6 };
    }],
    ["terminal newline in command identity", (input: ReturnType<typeof requestFor>) => {
      input.commandId += "\n";
    }],
    ["terminal newline in training source identity", (input: ReturnType<typeof requestFor>) => {
      input.trainingSourceRunId += "\n";
    }],
    ["terminal newline in issuance digest", (input: ReturnType<typeof requestFor>) => {
      input.trainingSourceIssuanceDigest += "\n";
    }],
  ])("rejects %s before reading source", async (_label, change) => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const request = requestFor(source, issuance);
    change(request);
    const missingHost = {
      ...host(source),
      datasetRoot: join(source.rootDir, "missing-dataset"),
      qualificationReceiptPath: join(source.rootDir, "missing-qualification.json"),
    };
    await expect(prepare(source, issuance, request, missingHost)).rejects.toBeInstanceOf(ZodError);
  });

  it("refuses validation overlapping training and a range outside the qualified source extent", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const overlapsTraining = requestFor(source, issuance);
    overlapsTraining.validation = { firstRecordIndex: 5, barCount: 6 };
    overlapsTraining.walkForward = [{ firstRecordIndex: 5, barCount: 2 }];
    await expect(prepare(source, issuance, overlapsTraining))
      .rejects.toThrow("RESEARCH_EVALUATION_SOURCE_TRAINING_BINDING_MISMATCH");

    const outsideFileRange = requestFor(source, issuance);
    outsideFileRange.validation = { firstRecordIndex: 12, barCount: 6 };
    outsideFileRange.walkForward = [{ firstRecordIndex: 12, barCount: 2 }];
    await expect(prepare(source, issuance, outsideFileRange))
      .rejects.toThrow("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:PARTITION_SCOPE");
  });

  it("refuses lineage that differs from the real fixture manifest", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source, { qualificationReceiptDigest: "9".repeat(64) });
    await expect(prepare(source, issuance)).rejects.toThrow("RESEARCH_EVALUATION_SOURCE_LINEAGE_MISMATCH");
  });

  it("refuses a mismatched training issuance digest and host release before source loading", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const request = requestFor(source, issuance);
    request.trainingSourceIssuanceDigest = "a".repeat(64);
    await expect(prepare(source, issuance, request))
      .rejects.toThrow("RESEARCH_EVALUATION_SOURCE_TRAINING_BINDING_MISMATCH");

    await expect(prepare(source, issuance, requestFor(source, issuance), {
      ...host(source), releaseSha: "e".repeat(40),
    })).rejects.toThrow("RESEARCH_EVALUATION_SOURCE_TRAINING_BINDING_MISMATCH");
  });

  it("refuses an altered source file even when selection metadata is otherwise valid", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const altered = source.bars.map((bar, index) => index === 13 ? { ...bar, volume: "999" } : bar);
    const filePath = join(source.datasetRoot,
      fhvOfficialPartitionFileRelativePath({ partition: "development", symbol: "BTCUSDT" }));
    writeFileSync(filePath, Buffer.from(altered
      .map(bar => serializeFhvBarsV2Record(barToFhvBarsV2Record(bar))).join(""), "utf8"));

    await expect(prepare(source, issuance))
      .rejects.toThrow("HISTORICAL_SIMULATION_V2_BOOTSTRAP_REFUSED:SOURCE_RANGE_MISSING");
  });

  it.each([
    ["gap in selected bars", (bars: readonly Bar[]) => bars.map((bar, index) => index >= 8 ? {
      ...bar,
      barOpenTime: new Date(Date.parse(bar.barOpenTime) + MINUTE_MS).toISOString(),
      barCloseTime: new Date(Date.parse(bar.barCloseTime) + MINUTE_MS).toISOString(),
    } : bar)],
    ["non-minute-aligned selected bar", (bars: readonly Bar[]) => bars.map((bar, index) => index === 8 ? {
      ...bar,
      barOpenTime: new Date(Date.parse(bar.barOpenTime) + 30_000).toISOString(),
      barCloseTime: new Date(Date.parse(bar.barCloseTime) + 30_000).toISOString(),
    } : bar)],
  ])("refuses a re-signed synthetic source with %s", async (_label, transform) => {
    const source = fixture();
    rewriteFixture(source, transform(source.bars));
    const issuance = trainingIssuance(source);
    const snapshot = await loadSyntheticSnapshot(source);
    expect(snapshot.sources).toHaveLength(6);
    expect(snapshot.sources[0]!.membership.recordIndex).toBe(6);
    if (_label === "gap in selected bars") {
      await expect(prepare(source, issuance))
        .rejects.toThrow("RESEARCH_EVALUATION_SOURCE_NONCONTIGUOUS_OR_BEFORE_TRAIN_END");
    } else {
      await expect(prepare(source, issuance)).rejects.toThrow("HTR_WP12_INGRESS_INTERVAL_MISALIGNED");
    }
  });

  it("honors a pre-aborted caller signal before opening the source", async () => {
    const source = fixture();
    const issuance = trainingIssuance(source);
    const controller = new AbortController();
    controller.abort();
    await expect(prepare(source, issuance, requestFor(source, issuance), host(source), controller.signal))
      .rejects.toThrow();
  });
});
