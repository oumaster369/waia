import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  assertFhvThroughputHostQualified,
  FhvThroughputReceiptError,
  FHV_THROUGHPUT_MIN_CPS,
  FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION,
  FHV_THROUGHPUT_RECEIPT_LEGACY_V1_FILENAME,
  FHV_THROUGHPUT_RECEIPT_SCHEMA,
} from "@/lib/trader/observability/fhv-throughput-receipt";
import { requiresWp3bTargetHostQualification } from "@/lib/trader/observability/fhv-launch-classification";

/**
 * Execution Server throughput host-qualification receipt (ADR-0025 AD-6b).
 *
 * 877/7200/6480 are unchanged; what moved is where absolute wall speed is authoritative. These tests
 * prove the receipt is fail-closed on every axis the writer binds, and that only the genuine official
 * unbounded launch requires it.
 */

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function samplerContract() {
  return {
    version: "fhv-throughput-qualifier-sampler/v1",
    maxIntervalMs: 250,
    appliedIntervalMs: 250,
    cycleAmortization: 256,
    minProgressSamples: 6,
    minHotWindows: 4,
    minCheckpointSamples: 2,
  };
}

function producerHost(
  overrides: Partial<
    import("@/lib/trader/observability/fhv-throughput-producer-binding").FhvThroughputProducerHostIdentityV1
  > = {},
) {
  return {
    hostname: "target-host",
    platform: "linux",
    arch: "x64",
    cpuModel: "test-cpu",
    cpuCount: 32,
    nodeVersion: "v22.23.0",
    machineIdSha256: "d".repeat(64),
    bootId: "11111111-1111-1111-1111-111111111111",
    ...overrides,
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  const host = producerHost();
  return {
    representativeSegmentExecuted: true,
    progressSamples: 12,
    checkpointSamples: 4,
    boundednessClassification: "BOUNDED",
    diagnosticGrowthBytesPerCycle: 96.9,
    hotPathDecayVerdict: "FLAT",
    growthAwareProjectionAvailable: true,
    growthAwareProjectedRuntimeS: 6000.0,
    runId: "fhv-qual-test-run",
    runDir: "/tmp/fhv-run",
    producerHost: host,
    progressBytesSha256: "a".repeat(64),
    growthLawReportDigest: "b".repeat(64),
    checkoutHeadSha: "release-sha-under-test",
    producerHeadSha: "release-sha-under-test",
    producerBindingDigest: "c".repeat(64),
    ...overrides,
  };
}

function writeReceipt(overrides: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "fhv-throughput-receipt-"));
  roots.push(root);
  const host = producerHost();
  const body: Record<string, unknown> = {
    schemaVersion: FHV_THROUGHPUT_RECEIPT_SCHEMA,
    capturedAtUtc: new Date().toISOString(),
    releaseSha: "release-sha-under-test",
    runId: "fhv-qual-test-run",
    host,
    contract: {
      minThroughputCps: 877,
      canonicalMaxRuntimeS: 7200,
      prelaunchMaxProjectedRuntimeS: 6480,
    },
    samplerContract: samplerContract(),
    evidence: evidence(),
    classification: FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION,
    ...overrides,
  };
  const receipt = {
    ...body,
    receiptDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
  const path = join(root, "fhv-throughput-host-qualification.v2.json");
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}

function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (caught) {
    return (caught as FhvThroughputReceiptError).code;
  }
}

describe("FHV throughput host-qualification receipt", () => {
  it("locks the canonical floor constant", () => {
    expect(FHV_THROUGHPUT_MIN_CPS).toBe(877);
  });

  it("accepts a canonical qualified receipt within the 6480 s pre-launch headroom", () => {
    const receipt = assertFhvThroughputHostQualified({
      receiptPath: writeReceipt(),
      expectedReleaseSha: "release-sha-under-test",
    });
    expect(receipt.classification).toBe(FHV_THROUGHPUT_QUALIFIED_CLASSIFICATION);
  });

  it("fails closed when the growth-aware projection exceeds 6480 s", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            evidence: evidence({
              growthAwareProjectedRuntimeS: 6480.1,
            }),
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_PROJECTION_EXCEEDS_6480S");
  });

  it("fails closed on a missing receipt", () => {
    expect(
      codeOf(() => assertFhvThroughputHostQualified({ receiptPath: "/nonexistent/r.json" })),
    ).toBe("FHV_THROUGHPUT_RECEIPT_MISSING");
  });

  it("fails closed on malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-throughput-bad-"));
    roots.push(root);
    const path = join(root, "receipt.json");
    writeFileSync(path, "{ not json", "utf8");
    expect(codeOf(() => assertFhvThroughputHostQualified({ receiptPath: path }))).toBe(
      "FHV_THROUGHPUT_RECEIPT_MALFORMED",
    );
  });

  it("fails closed on a tampered self-digest", () => {
    const path = writeReceipt();
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    (tampered.evidence as Record<string, unknown>).growthAwareProjectedRuntimeS = 1000;
    writeFileSync(path, JSON.stringify(tampered), "utf8");
    expect(codeOf(() => assertFhvThroughputHostQualified({ receiptPath: path }))).toBe(
      "FHV_THROUGHPUT_RECEIPT_DIGEST_MISMATCH",
    );
  });

  it("fails closed on a release identity mismatch", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt(),
          expectedReleaseSha: "different-release",
        }),
      ),
    ).toBe("FHV_THROUGHPUT_RECEIPT_RELEASE_MISMATCH");
  });

  it("fails closed on a missing host identity", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            host: { hostname: "", platform: "linux", arch: "x64", cpuModel: "c" },
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_PRODUCER_HOST_IDENTITY_MISSING");
  });

  it("fails closed when receipt host disagrees with execution-time producer host", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            host: producerHost({ hostname: "other-host" }),
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_PRODUCER_HOST_MISMATCH");
  });

  it("fails closed on insufficient progress/checkpoint evidence", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            evidence: evidence({
              progressSamples: 1,
              checkpointSamples: 1,
            }),
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_INSUFFICIENT_EVIDENCE");
  });

  it("fails closed when the hot path is DECAYING", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            evidence: evidence({
              hotPathDecayVerdict: "DECAYING",
            }),
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_HOT_PATH_DECAYING");
  });

  it("fails closed on a weakened embedded contract", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            contract: {
              minThroughputCps: 500,
              canonicalMaxRuntimeS: 7200,
              prelaunchMaxProjectedRuntimeS: 6480,
            },
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_CONTRACT_MISMATCH");
  });

  it("fails closed on a non-qualified classification", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            classification: "EXECUTION_SERVER_FHV_THROUGHPUT_NOT_QUALIFIED",
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_NOT_QUALIFIED");
  });

  it("records checkpoint samples independently of progress samples", () => {
    const receipt = assertFhvThroughputHostQualified({
      receiptPath: writeReceipt({
        evidence: evidence({ progressSamples: 12, checkpointSamples: 4 }),
      }),
      expectedReleaseSha: "release-sha-under-test",
    });
    expect(receipt.evidence.checkpointSamples).toBe(4);
    expect(receipt.evidence.progressSamples).toBe(12);
    expect(receipt.evidence.checkpointSamples).not.toBe(receipt.evidence.progressSamples);
  });

  it("rejects an unbound v1 receipt path", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-throughput-v1-"));
    roots.push(root);
    const path = join(root, FHV_THROUGHPUT_RECEIPT_LEGACY_V1_FILENAME);
    writeFileSync(path, "{}\n", "utf8");
    expect(codeOf(() => assertFhvThroughputHostQualified({ receiptPath: path }))).toBe(
      "FHV_THROUGHPUT_RECEIPT_SCHEMA_UNSUPPORTED",
    );
  });

  it("fails closed when boundedness is not BOUNDED", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            evidence: evidence({ boundednessClassification: "UNBOUNDED" }),
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_BOUNDEDNESS_NOT_BOUNDED");
  });

  it("fails closed when sampler contract fields are weakened", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            samplerContract: { ...samplerContract(), maxIntervalMs: 60_000 },
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_SAMPLER_MAX_INTERVAL_WEAKENED");
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            samplerContract: { ...samplerContract(), appliedIntervalMs: 1_000 },
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_SAMPLER_APPLIED_INTERVAL_OUT_OF_RANGE");
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            samplerContract: { ...samplerContract(), minCheckpointSamples: 1 },
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_SAMPLER_MIN_CHECKPOINT_WEAKENED");
  });

  it("fails closed when producer HEAD does not match the claimed release", () => {
    expect(
      codeOf(() =>
        assertFhvThroughputHostQualified({
          receiptPath: writeReceipt({
            evidence: evidence({ producerHeadSha: "a".repeat(40) }),
          }),
        }),
      ),
    ).toBe("FHV_THROUGHPUT_RECEIPT_PRODUCER_RELEASE_MISMATCH");
  });
});

describe("FHV throughput launch boundary (ADR-0025 AD-6b)", () => {
  const officialUnbounded = {
    boundedFixture: false,
    maxCycles: undefined,
    executionPurpose: "FULL_HISTORICAL" as const,
    qualificationMode: "OFFICIAL_MULTI_YEAR",
  };

  it("requires a throughput receipt only for the genuine official unbounded campaign", () => {
    expect(requiresWp3bTargetHostQualification(officialUnbounded)).toBe(true);
  });

  it("does not require a receipt for bounded fixtures, probes, parity or control replay", () => {
    expect(
      requiresWp3bTargetHostQualification({ ...officialUnbounded, boundedFixture: true }),
    ).toBe(false);
    expect(requiresWp3bTargetHostQualification({ ...officialUnbounded, maxCycles: 4509 })).toBe(
      false,
    );
    expect(requiresWp3bTargetHostQualification({ ...officialUnbounded, maxCycles: null })).toBe(
      true,
    );
    expect(
      requiresWp3bTargetHostQualification({
        ...officialUnbounded,
        executionPurpose: "CONTROL_REPLAY",
      }),
    ).toBe(false);
  });

  it("cannot be weakened by any environment variable on the official unbounded path", () => {
    const saved = { ...process.env };
    try {
      Object.assign(process.env, { NODE_ENV: "test" });
      process.env.CI = "true";
      process.env.GITHUB_ACTIONS = "true";
      process.env.FHV_OFFICIAL_LAUNCH = "0";
      process.env.FHV_SKIP_WP3B_LAUNCH_GATE = "1";
      process.env.FHV_SKIP_THROUGHPUT_QUALIFICATION = "1";
      expect(requiresWp3bTargetHostQualification(officialUnbounded)).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});
