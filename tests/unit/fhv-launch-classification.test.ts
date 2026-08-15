import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import {
  classifyFhvLaunch,
  requiresWp3bTargetHostQualification,
} from "@/lib/trader/observability/fhv-launch-classification";
import {
  assertFhvWp3bHostQualified,
  FhvWp3bReceiptError,
} from "@/lib/trader/observability/fhv-wp3b-receipt";

/**
 * WP-3B launch boundary (ADR-0025 AD-6a).
 *
 * The gate must be decided by validated configuration. An earlier revision keyed it on
 * `FHV_OFFICIAL_LAUNCH`, so an operator who forgot the variable silently skipped the host
 * qualification — safety that depends on remembering to ask for it is not safety.
 */

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Canonical fixture builder: identity is explicit and bounded to the test. */
function writeReceipt(overrides: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "fhv-wp3b-receipt-"));
  roots.push(root);
  const body: Record<string, unknown> = {
    schemaVersion: "fhv-wp3b-host-qualification/v2",
    capturedAtUtc: new Date().toISOString(),
    releaseSha: "release-sha-under-test",
    host: { hostname: "test-host", platform: "darwin", sha256BytesPerSecond: 2_800_000_000 },
    cloneCapability: {
      supported: true,
      status: "NATIVE_CLONE_SUCCEEDED",
      mechanism: "darwin:clonefile",
    },
    identityProofs: { digestsMatch: true, mutationIsolated: true, cloneClaimTruthful: true },
    contract: { qualificationDepthBytes: 1_073_741_824, budgetMs: 400 },
    fixtureBytes: 1_073_741_824,
    measurements: {
      measuredMs: [392.1, 394.5, 396.0],
      everyIterationWithinBudget: true,
      durabilityInsideTimer: true,
      negativeTestDetectsBreach: true,
    },
    gate1BlockingCapture: {
      status: "PASS",
      measuredMs: [12.1, 13.0, 11.4],
      budgetMs: 400,
    },
    gate2DestinationVerification: {
      status: "PASS",
      measuredMs: [390.0, 392.1, 394.0],
      budgetMs: Math.ceil((10_000 / 877) * 1000),
    },
    classification: "EXECUTION_SERVER_WP3B_HOST_QUALIFIED",
    ...overrides,
  };
  const receipt = {
    ...body,
    receiptDigest: createHash("sha256").update(JSON.stringify(body)).digest("hex"),
  };
  const path = join(root, "fhv-wp3b-host-qualification.v1.json");
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  return path;
}

/** Returns the canonical error code, so assertions bind to the contract rather than wording. */
function codeOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (caught) {
    return (caught as FhvWp3bReceiptError).code;
  }
}

const officialUnbounded = {
  boundedFixture: false,
  maxCycles: undefined,
  executionPurpose: "FULL_HISTORICAL" as const,
  qualificationMode: "OFFICIAL_MULTI_YEAR",
};

describe("FHV launch classification", () => {
  it("requires target-host qualification only for the official unbounded campaign", () => {
    expect(classifyFhvLaunch(officialUnbounded)).toBe("OFFICIAL_UNBOUNDED_FULL_HISTORICAL");
    expect(requiresWp3bTargetHostQualification(officialUnbounded)).toBe(true);
  });

  it("permits every bounded software-qualification path without a receipt", () => {
    // Synthetic scale probe and process-parity runs: bounded by an explicit cycle cap.
    expect(requiresWp3bTargetHostQualification({ ...officialUnbounded, maxCycles: 4509 })).toBe(
      false,
    );
    expect(requiresWp3bTargetHostQualification({ ...officialUnbounded, maxCycles: 1000 })).toBe(
      false,
    );
    // Bounded fixture and schema-integration ceremonies.
    expect(
      requiresWp3bTargetHostQualification({ ...officialUnbounded, boundedFixture: true }),
    ).toBe(false);
    // Non-official dataset qualification.
    expect(
      requiresWp3bTargetHostQualification({ ...officialUnbounded, qualificationMode: "BOUNDED" }),
    ).toBe(false);
    // Other purposes, such as control replay.
    expect(
      requiresWp3bTargetHostQualification({
        ...officialUnbounded,
        executionPurpose: "CONTROL_REPLAY",
      }),
    ).toBe(false);
  });

  it("treats maxCycles, not synthetic authority presence, as the bounded distinction", () => {
    // An unbounded official run may still carry a synthetic authority for targetCycleCount.
    expect(requiresWp3bTargetHostQualification({ ...officialUnbounded, maxCycles: null })).toBe(
      true,
    );
  });

  it("cannot be bypassed by any environment variable", () => {
    const saved = { ...process.env };
    try {
      // Every historical bypass, plus the ambient CI signals, must be powerless.
      process.env.FHV_OFFICIAL_LAUNCH = "0";
      process.env.FHV_SKIP_WP3B_LAUNCH_GATE = "1";
      Object.assign(process.env, { NODE_ENV: "test" });
      process.env.CI = "true";
      process.env.GITHUB_ACTIONS = "true";
      expect(requiresWp3bTargetHostQualification(officialUnbounded)).toBe(true);

      delete process.env.FHV_OFFICIAL_LAUNCH;
      expect(requiresWp3bTargetHostQualification(officialUnbounded)).toBe(true);
    } finally {
      process.env = saved;
    }
  });
});

describe("FHV WP-3B receipt validation", () => {
  it("accepts a canonical qualified receipt", () => {
    const receipt = assertFhvWp3bHostQualified({
      receiptPath: writeReceipt(),
      expectedReleaseSha: "release-sha-under-test",
    });
    expect(receipt.classification).toBe("EXECUTION_SERVER_WP3B_HOST_QUALIFIED");
  });

  it("fails closed on a missing receipt", () => {
    expect(
      codeOf(() => assertFhvWp3bHostQualified({ receiptPath: "/nonexistent/receipt.json" })),
    ).toBe("FHV_WP3B_RECEIPT_MISSING");
  });

  it("fails closed on malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-wp3b-bad-"));
    roots.push(root);
    const path = join(root, "receipt.json");
    writeFileSync(path, "{ not json", "utf8");
    expect(codeOf(() => assertFhvWp3bHostQualified({ receiptPath: path }))).toBe(
      "FHV_WP3B_RECEIPT_MALFORMED",
    );
  });

  it("fails closed on a tampered digest", () => {
    const path = writeReceipt();
    const tampered = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    tampered.classification = "EXECUTION_SERVER_WP3B_HOST_QUALIFIED";
    (tampered.measurements as Record<string, unknown>).measuredMs = [10, 10, 10];
    writeFileSync(path, JSON.stringify(tampered), "utf8");
    expect(codeOf(() => assertFhvWp3bHostQualified({ receiptPath: path }))).toBe(
      "FHV_WP3B_RECEIPT_DIGEST_MISMATCH",
    );
  });

  it("fails closed on an unrelated release identity", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({
          receiptPath: writeReceipt(),
          expectedReleaseSha: "a-different-release",
        }),
      ),
    ).toBe("FHV_WP3B_RECEIPT_RELEASE_MISMATCH");
  });

  it("fails closed when a fallback copy is misreported as a clone", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({
          receiptPath: writeReceipt({
            cloneCapability: {
              supported: false,
              status: "NATIVE_CLONE_UNSUPPORTED",
              mechanism: "linux:FICLONE",
            },
          }),
        }),
      ),
    ).toBe("FHV_WP3B_NATIVE_CLONE_NOT_PROVEN");
  });

  it("fails closed when any single measured checkpoint exceeds 400 ms", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({
          receiptPath: writeReceipt({
            measurements: {
              measuredMs: [392.1, 401.2, 396.0],
              everyIterationWithinBudget: false,
              durabilityInsideTimer: true,
              negativeTestDetectsBreach: true,
            },
          }),
        }),
      ),
    ).toBe("FHV_WP3B_CHECKPOINT_BUDGET_EXCEEDED");
  });

  it("fails closed on a shallow qualification depth", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({ receiptPath: writeReceipt({ fixtureBytes: 536_870_912 }) }),
      ),
    ).toBe("FHV_WP3B_QUALIFICATION_DEPTH_TOO_SHALLOW");
  });

  it("fails closed on a non-qualified classification", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({
          receiptPath: writeReceipt({ classification: "EXECUTION_SERVER_WP3B_HOST_NOT_QUALIFIED" }),
        }),
      ),
    ).toBe("FHV_WP3B_HOST_NOT_QUALIFIED");
  });

  it("fails closed when GATE 1 is not PASS", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({
          receiptPath: writeReceipt({
            gate1BlockingCapture: { status: "FAIL", measuredMs: [401, 402, 403], budgetMs: 400 },
          }),
        }),
      ),
    ).toBe("FHV_WP3B_GATE1_FAILED");
  });

  it("fails closed when GATE 2 is not PASS", () => {
    expect(
      codeOf(() =>
        assertFhvWp3bHostQualified({
          receiptPath: writeReceipt({
            gate2DestinationVerification: {
              status: "FAIL",
              measuredMs: [1, 1, 1],
              budgetMs: Math.ceil((10_000 / 877) * 1000),
            },
          }),
        }),
      ),
    ).toBe("FHV_WP3B_GATE2_FAILED");
  });
});
