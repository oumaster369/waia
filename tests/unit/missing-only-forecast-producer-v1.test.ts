// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import {
  buildPredictivePackageV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { buildPreservedWfExpectedInventoryV1 } from "../../scripts/trader/preserved-wf-inventory-v1";
import {
  mappingContentDigestHexV1,
  parseG1TrustedOriginMappingEnvelopeV1,
} from "../../scripts/trader/g1-trusted-origin-mapping-schema-v1";
import {
  bindMissingOnlyProducerIdentityV1,
  createOriginReadOnlyPortV1,
  createProducerJournalV1,
  enumerateMissingWfForecastBatchesV1,
  expectedOffsetsV1,
  issueControlForecastBatchV1,
  issueMissingForecastBatchV1,
  parseProducerMappingInputV1,
  refuseCoverageGapV1,
  type MissingOnlyProducerIdentityV1,
} from "../../scripts/trader/missing-only-forecast-producer-v1";
import { runMissingOnlyForecastProducerCliV1 } from "../../scripts/trader/missing-only-forecast-producer-cli-v1";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ORIGIN_SHA = "9".repeat(40);
const PRODUCER_SHA = "b".repeat(40);
const ORG = "00000000-0000-4000-8000-000000000001";
const runtime = () =>
  Object.freeze({ node: process.version, os: process.platform, arch: process.arch });
const SOURCE_ROOT = resolve(".");

function corpus(symbol: "BTCUSDT" | "ETHUSDT", count: number, seed = "wf"): SourceAnchor[] {
  return Array.from({ length: count }, (_, i) => ({
    venue: "htx",
    market: "spot",
    symbol,
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: sha(`${seed}-${i}`),
    realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
    outcome13d: [
      0.001,
      0.002,
      0.003,
      ((i % 11) - 5) / 1000,
      0.004,
      0.005,
      0.006,
      100,
      101,
      102,
      103,
      104,
      105,
    ],
  }));
}

function makeSurface(input: {
  symbol: "BTCUSDT" | "ETHUSDT";
  primaryHorizonMinutes: 30 | 60;
  sourceCorpus: readonly SourceAnchor[];
  selectedPackage: {
    chunkCount: number;
    contentDigestHex: string;
    generationDigestHex: string;
    packageKey: string;
    runtimeContractDigestHex: string;
    sourceCount: number;
    targetGridDigestHex: string;
  };
  k: number;
  m: number;
  originPresentBatches?: number;
}) {
  const expectedAnchors = input.sourceCorpus.length;
  const expectedBatches = Math.ceil(expectedAnchors / 32);
  const lastBatchAnchorCount = expectedAnchors % 32 || 32;
  const originPresent = input.originPresentBatches ?? 0;
  const inventory = buildPreservedWfExpectedInventoryV1({
    origin: {
      organizationId: ORG,
      symbol: input.symbol,
      primaryHorizonMinutes: input.primaryHorizonMinutes,
      releaseSha: ORIGIN_SHA,
      runtime: runtime(),
      packageGenerationDigestHex: input.selectedPackage.generationDigestHex,
      packageContentDigestHex: input.selectedPackage.contentDigestHex,
    },
    evaluationPartitionReceiptDigestHex: sha(
      `receipt-${input.symbol}-${input.primaryHorizonMinutes}`,
    ),
    sourceCorpus: input.sourceCorpus,
  });
  const expectedKeyOrderDigest = sha(inventory.batches.map((batch) => batch.key).join("\n"));
  return {
    development: {
      datasetDigestHex: sha("dataset"),
      rawSha256Hex: sha("raw"),
      sourceCount: input.selectedPackage.sourceCount,
    },
    evaluationPartition: {
      qualificationReceiptDigestHex: sha("qual"),
      receiptDigestHex: sha(`receipt-${input.symbol}-${input.primaryHorizonMinutes}`),
      walkForwardRawSha256Hex: sha("wf-raw"),
    },
    expectedWfForecastBatchDomain: {
      authenticatedMatchingBatches: originPresent,
      batchSize: 32,
      expectedAnchors,
      expectedBatches,
      expectedKeyOrderDigest,
      lastBatchAnchorCount,
      missingBatches: expectedBatches - originPresent,
      offsets: { endExclusive: expectedAnchors, start: 0, step: 32 },
      stage: "wf-forecast-batch-v1",
      wfStatus: originPresent ? "PARTIAL" : "MISSING_ORIGINAL_FORECAST_BATCHES",
    },
    kmSelection: {
      k: input.k,
      kmBindingStatus: "SYNTHETIC",
      m: input.m,
      surfaceAnchorSetDigestHex: sha("anchors"),
    },
    market: "spot" as const,
    origin: { releaseSha: ORIGIN_SHA, runtime: runtime() },
    primaryHorizonMinutes: input.primaryHorizonMinutes,
    selectedPackage: { ...input.selectedPackage, selectionRule: "SYNTHETIC_FIXTURE" },
    surfaceKey: `${input.symbol}:${input.primaryHorizonMinutes}` as const,
    symbol: input.symbol,
    venue: "htx" as const,
  };
}

function makeEnvelope(surfaces: ReturnType<typeof makeSurface>[]) {
  const mapping = {
    O: { organizationId: ORG, releaseSha: ORIGIN_SHA, runId: "synthetic-run", runtime: runtime() },
    S0: "c".repeat(40),
    authorityGranted: false as const,
    dataset: {
      datasetContentDigest: sha("dataset-root"),
      originRuntimeRequalificationDigest: sha("requal"),
      qualificationReceiptDigestHex: sha("qual"),
      root: "/tmp/synthetic-g1-dataset",
    },
    generationAuthority: "NOT_GRANTED" as const,
    provenance: { note: "synthetic-fixture" },
    schemaVersion: "waia.trader.g1_trusted_origin_mapping.v1" as const,
    scientificAdmission: "NOT_GRANTED" as const,
    sealedAtUtc: "2026-09-13T00:00:00Z",
    serverWrite: "NOT_PERFORMED" as const,
    surfaces,
    totals: {
      missingForecastBatches: surfaces.reduce(
        (sum, surface) => sum + surface.expectedWfForecastBatchDomain.missingBatches,
        0,
      ),
      missingForecastRows: surfaces.reduce(
        (sum, surface) => sum + surface.expectedWfForecastBatchDomain.expectedAnchors,
        0,
      ),
      originCompleteForecastBatches: surfaces.reduce(
        (sum, surface) => sum + surface.expectedWfForecastBatchDomain.authenticatedMatchingBatches,
        0,
      ),
    },
    unselectedDuplicatePackageKeys: [],
  };
  return parseG1TrustedOriginMappingEnvelopeV1({
    authorityGranted: false,
    contentDigestHex: mappingContentDigestHexV1(mapping),
    mapping,
    schemaVersion: "waia.trader.g1_trusted_origin_mapping_envelope.v1",
  });
}

const producerSource = [
  readFileSync(resolve("scripts/trader/missing-only-forecast-producer-v1.ts"), "utf8"),
  readFileSync(resolve("scripts/trader/missing-only-forecast-producer-cli-v1.ts"), "utf8"),
].join("\n");

let identity: MissingOnlyProducerIdentityV1;
let pkg: ReturnType<typeof buildPredictivePackageV1>;
let wf: SourceAnchor[];
let envelope: ReturnType<typeof makeEnvelope>;
let originRoot: string;
let producerRoot: string;
let evidenceRoot: string;

beforeAll(() => {
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  identity = bindMissingOnlyProducerIdentityV1({
    producerGitSha: PRODUCER_SHA,
    sourceRoot: SOURCE_ROOT,
  });
  const family = buildHistoricalForecastFamilyV2({
    organizationId: ORG,
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    developmentDatasetDigestHex: sha("dataset"),
    releaseSha: ORIGIN_SHA,
  });
  const development = corpus("BTCUSDT", 120, "dev");
  pkg = buildPredictivePackageV1({
    family,
    sourceCorpus: development,
    kConfigDec: 2,
    mConfigDec: 20,
  });
  wf = corpus("BTCUSDT", 40, "wf");
  envelope = makeEnvelope([
    makeSurface({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      sourceCorpus: wf,
      selectedPackage: {
        chunkCount: 1,
        contentDigestHex: pkg.predictivePackageContentDigest.toString("hex"),
        generationDigestHex: pkg.predictivePackageGenerationIdentityDigest.toString("hex"),
        packageKey: sha("package-key"),
        runtimeContractDigestHex: pkg.runtimeContractDigest.toString("hex"),
        sourceCount: 120,
        targetGridDigestHex: pkg.terminalTargetGridIdentityDigestHex,
      },
      k: 2,
      m: 20,
    }),
  ]);
});

beforeEach(() => {
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  originRoot = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee950-origin-")));
  producerRoot = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee950-producer-")));
  evidenceRoot = realpathSync(mkdtempSync(join(tmpdir(), "waia-dee950-evidence-")));
  chmodSync(originRoot, 0o700);
  chmodSync(producerRoot, 0o700);
  chmodSync(evidenceRoot, 0o700);
});
afterEach(() => {
  rmSync(originRoot, { recursive: true, force: true });
  rmSync(producerRoot, { recursive: true, force: true });
  rmSync(evidenceRoot, { recursive: true, force: true });
});

function sealOriginBatch(offset: number) {
  const surface = envelope.mapping.surfaces[0]!;
  const batch = wf.slice(offset, offset + 32);
  createScientificCheckpointStoreV1(originRoot, ORIGIN_SHA).evidence(
    "wf-forecast-batch-v1",
    {
      organizationId: ORG,
      releaseSha: ORIGIN_SHA,
      generationDigest: surface.selectedPackage.generationDigestHex,
      packageDigest: surface.selectedPackage.contentDigestHex,
      evaluationPartitionReceiptDigestHex: surface.evaluationPartition.receiptDigestHex,
      offset,
      batch,
    },
    () => [{ synthetic: true }],
  );
}

describe("DEE-950 missing-only Forecast producer", () => {
  it("refuses a package builder fallback instead of constructing a selected package", () => {
    expect(() =>
      enumerateMissingWfForecastBatchesV1({
        envelope,
        surfaceKey: "BTCUSDT:30",
        sourceCorpus: wf,
        origin: { hasSealedKey: () => false },
        buildPackage: () => pkg,
      } as never),
    ).toThrow("BUILDER_FALLBACK");
    expect(() =>
      issueControlForecastBatchV1({
        envelope,
        identity,
        surfaceKey: "BTCUSDT:30",
        pkg: undefined as never,
        sourceCorpus: wf,
        offset: 0,
        buildPackage: () => pkg,
      } as never),
    ).toThrow("BUILDER_FALLBACK");
  });

  it("refuses a missing mapping envelope", () => {
    const write = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      expect(() => parseProducerMappingInputV1(null)).toThrow("MISSING_MAPPING");
      expect(() => parseProducerMappingInputV1(undefined)).toThrow("MISSING_MAPPING");
      expect(runMissingOnlyForecastProducerCliV1([])).toBe(64);
    } finally {
      write.mockRestore();
    }
  });

  it("refuses a duplicate in-progress claim", () => {
    const journal = createProducerJournalV1(producerRoot, identity);
    journal.claim("BTCUSDT:30", 0);
    expect(() => journal.claim("BTCUSDT:30", 0)).toThrow("DUPLICATE_CLAIM");
  });

  it("refuses a duplicate completed batch", () => {
    const journal = createProducerJournalV1(producerRoot, identity);
    journal.claim("BTCUSDT:30", 0);
    journal.complete({
      surfaceKey: "BTCUSDT:30",
      offset: 0,
      originKey: "a".repeat(64),
      producerKey: "c".repeat(64),
      payloadDigest: sha("payload"),
      rowsSha256: sha("rows"),
    });
    expect(() =>
      journal.complete({
        surfaceKey: "BTCUSDT:30",
        offset: 0,
        originKey: "a".repeat(64),
        producerKey: "c".repeat(64),
        payloadDigest: sha("payload-2"),
        rowsSha256: sha("rows-2"),
      }),
    ).toThrow("DUPLICATE_COMPLETED");
    expect(() => journal.claim("BTCUSDT:30", 0)).toThrow("DUPLICATE_COMPLETED");
  });

  it("refuses an accepted coverage gap", () => {
    expect(() => refuseCoverageGapV1([0, 32, 64], [0], [0, 64])).toThrow("GAP");
    expect(() => refuseCoverageGapV1([0, 32], [], [32])).toThrow("GAP");
    expect(() => refuseCoverageGapV1([0, 32], [0], [32])).not.toThrow();
    expect(() => refuseCoverageGapV1([0, 32], [0, 32], [0, 32])).not.toThrow();
  });

  it("refuses an origin write attempt through the read-only origin port", () => {
    const origin = createOriginReadOnlyPortV1(originRoot);
    const journal = createProducerJournalV1(producerRoot, identity);
    expect(() => origin.package()).toThrow("ORIGIN_WRITE");
    expect(() => origin.evidence()).toThrow("ORIGIN_WRITE");
    expect(() => origin.evidenceAsync()).toThrow("ORIGIN_WRITE");
    expect(() =>
      issueMissingForecastBatchV1({
        envelope,
        identity,
        origin,
        journal,
        producerEvidenceRoot: originRoot,
        surfaceKey: "BTCUSDT:30",
        pkg,
        sourceCorpus: wf,
        offset: 0,
      }),
    ).toThrow("ORIGIN_WRITE");
  });

  it("keeps bootstrap and admission APIs out of the producer", () => {
    expect(producerSource).toContain("issueForecastV1");
    expect(producerSource).not.toContain("buildPredictivePackageV1");
    expect(producerSource).not.toContain("historical-four-surface-ratified-admission-v2");
    expect(producerSource).not.toContain("km-four-surface-production-bootstrap");
    expect(producerSource).not.toContain("validation-bootstrap-v1");
    expect(producerSource).not.toContain("finalizeApprovedHistoricalProposal");
    expect(producerSource).not.toContain("Human");
    expect(identity.contractVersion).toBe("waia.trader.missing_only_forecast_producer.v1");
    expect(identity.producerGitSha).toBe(PRODUCER_SHA);
    expect(identity.issueForecastTransitiveSourceClosureDigestHex).toMatch(/^[a-f0-9]{64}$/);
    expect(identity.issueForecastTransitiveSourceFileCount).toBeGreaterThan(8);
    expect(identity.authorityGranted).toBe(false);
  });

  it("enumerates only missing wf-forecast-batch-v1 keys", () => {
    sealOriginBatch(0);
    const origin = createOriginReadOnlyPortV1(originRoot);
    const missing = enumerateMissingWfForecastBatchesV1({
      envelope,
      surfaceKey: "BTCUSDT:30",
      sourceCorpus: wf,
      origin,
    });
    expect(missing.map((batch) => [batch.offset, batch.anchorCount])).toEqual([[32, 8]]);
    expect(missing[0]!.originKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it("issues a deterministic 32-row control batch and hashes rows", () => {
    const control = issueControlForecastBatchV1({
      envelope,
      identity,
      surfaceKey: "BTCUSDT:30",
      pkg,
      sourceCorpus: wf,
      offset: 0,
    });
    expect(control.rowCount).toBe(32);
    expect(control.rows).toHaveLength(32);
    expect(control.rowsSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(control.authorityGranted).toBe(false);
    expect(control.rows[0]!.challengerProbabilities).toHaveLength(7);
    const replay = issueControlForecastBatchV1({
      envelope,
      identity,
      surfaceKey: "BTCUSDT:30",
      pkg,
      sourceCorpus: wf,
      offset: 0,
    });
    expect(replay.rowsSha256).toBe(control.rowsSha256);
    expect(
      issueControlForecastBatchV1({
        envelope,
        identity,
        surfaceKey: "BTCUSDT:30",
        pkg,
        sourceCorpus: wf,
        offset: 32,
      }).rowsSha256,
    ).not.toBe(control.rowsSha256);
  });

  it("resumes by skipping sealed producer batches", () => {
    const origin = createOriginReadOnlyPortV1(originRoot);
    const journal = createProducerJournalV1(producerRoot, identity);
    const first = issueMissingForecastBatchV1({
      envelope,
      identity,
      origin,
      journal,
      producerEvidenceRoot: evidenceRoot,
      surfaceKey: "BTCUSDT:30",
      pkg,
      sourceCorpus: wf,
      offset: 0,
    });
    expect(first.rowCount).toBe(32);
    const missing = enumerateMissingWfForecastBatchesV1({
      envelope,
      surfaceKey: "BTCUSDT:30",
      sourceCorpus: wf,
      origin,
      journal,
    });
    expect(missing.map((batch) => batch.offset)).toEqual([32]);
    expect(() =>
      issueMissingForecastBatchV1({
        envelope,
        identity,
        origin,
        journal,
        producerEvidenceRoot: evidenceRoot,
        surfaceKey: "BTCUSDT:30",
        pkg,
        sourceCorpus: wf,
        offset: 0,
      }),
    ).toThrow("NOT_MISSING");
  });

  it("accepts disjoint surface and offset claims", () => {
    const journal = createProducerJournalV1(producerRoot, identity);
    journal.claim("BTCUSDT:30", 0);
    journal.claim("BTCUSDT:30", 32);
    journal.claim("ETHUSDT:60", 0);
    expect(expectedOffsetsV1(envelope.mapping.surfaces[0]!.expectedWfForecastBatchDomain)).toEqual([
      0, 32,
    ]);
  });

  it("refuses collapsing producer identity into origin identity", () => {
    const collapsed = bindMissingOnlyProducerIdentityV1({
      producerGitSha: ORIGIN_SHA,
      sourceRoot: SOURCE_ROOT,
    });
    expect(() =>
      issueControlForecastBatchV1({
        envelope,
        identity: collapsed,
        surfaceKey: "BTCUSDT:30",
        pkg,
        sourceCorpus: wf,
        offset: 0,
      }),
    ).toThrow("O_P_COLLAPSE");
  });

  it("executes enumerate mode on the dedicated CLI without issuing Forecasts", () => {
    const mappingPath = join(producerRoot, "mapping.json");
    const anchorsPath = join(producerRoot, "anchors.json");
    writeFileSync(
      mappingPath,
      JSON.stringify({
        authorityGranted: false,
        contentDigestHex: mappingContentDigestHexV1(envelope.mapping),
        mapping: envelope.mapping,
        schemaVersion: envelope.schemaVersion,
      }),
    );
    writeFileSync(anchorsPath, JSON.stringify(wf));
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--conditions=react-server",
        resolve("scripts/trader/missing-only-forecast-producer-cli-v1.ts"),
        "--mapping",
        mappingPath,
        "--mode",
        "enumerate",
        "--producer-sha",
        PRODUCER_SHA,
        "--source-root",
        SOURCE_ROOT,
        "--origin-root",
        originRoot,
        "--producer-root",
        join(producerRoot, "journal"),
        "--surface",
        "BTCUSDT:30",
        "--anchors-json",
        anchorsPath,
      ],
      { encoding: "utf8", timeout: 20000, env: { ...process.env, WAIA_TRADER_CLI: "1" } },
    );
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const body = JSON.parse(result.stdout);
    expect(body).toMatchObject({
      authorityGranted: false,
      surfaceKey: "BTCUSDT:30",
      missingCount: 2,
    });
    expect(body.missing).toEqual([
      { offset: 0, anchorCount: 32 },
      { offset: 32, anchorCount: 8 },
    ]);
    expect(result.stdout).not.toContain("buildPredictivePackageV1");
  });
});
