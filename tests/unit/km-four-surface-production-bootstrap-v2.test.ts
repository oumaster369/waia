import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { SourceAnchor } from
  "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import type { FhvPreHoldoutQualificationReceiptV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import type { FhvPreHoldoutRuntimeRequalificationV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import type { KmAnchorReplayEvidenceV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-contract-v2";
import {
  KM_FOUR_SURFACE_EXECUTABLE_EVALUATOR_V2,
  TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2,
  type KmFourSurfaceDurableDatasetAuthorityV2,
} from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000917";
const SOURCE_RELEASE = "a".repeat(40);
const TARGET_RELEASE = "b".repeat(40);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function qualificationReceipt(): FhvPreHoldoutQualificationReceiptV1 {
  return {
    releaseSha: SOURCE_RELEASE,
    organizationId: ORGANIZATION_ID,
    qualificationReceiptDigest: digest("qualification"),
    developmentContentDigest: digest("development"),
    developmentWalkForwardContentDigest: digest("development-walk-forward"),
    holdout: { status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" },
    partitions: [
      { partition: "development", symbol: "BTCUSDT",
        rawSha256: digest("development:BTCUSDT:raw") },
      { partition: "development", symbol: "ETHUSDT",
        rawSha256: digest("development:ETHUSDT:raw") },
    ],
  } as unknown as FhvPreHoldoutQualificationReceiptV1;
}

function runtimeReceipt(
  qualification: FhvPreHoldoutQualificationReceiptV1,
): FhvPreHoldoutRuntimeRequalificationV1 {
  return {
    schemaVersion: "fhv-pre-holdout-runtime-requalification/v1",
    classification: "RUNTIME_REQUALIFICATION=PASS",
    sourceQualificationReceiptDigest: qualification.qualificationReceiptDigest,
    sourceReleaseSha: qualification.releaseSha,
    targetReleaseSha: TARGET_RELEASE,
    datasetContentDigest: qualification.developmentWalkForwardContentDigest,
    organizationId: qualification.organizationId,
    operatorId: "test-operator",
    verifiedAtUtc: "2026-09-02T00:00:00.000Z",
    requalificationReceiptDigest: digest("runtime-requalification"),
  };
}

function durableAuthority(
  qualification: FhvPreHoldoutQualificationReceiptV1,
): KmFourSurfaceDurableDatasetAuthorityV2 {
  return {
    organizationId: ORGANIZATION_ID,
    runId: "run-dee-917",
    qualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
    authorityRowCount: 2,
    cycleIds: [
      "run-dee-917:DEVELOPMENT:BTCUSDT:100",
      "run-dee-917:DEVELOPMENT:ETHUSDT:100",
    ],
    developmentSymbols: ["BTCUSDT", "ETHUSDT"],
    developmentPartitionRawSha256Hex: {
      BTCUSDT: digest("development:BTCUSDT:raw"),
      ETHUSDT: digest("development:ETHUSDT:raw"),
    },
    authoritySetContentDigestHex: digest("durable-authority-set"),
  };
}

function corpus(
  symbol: "BTCUSDT" | "ETHUSDT",
  primaryHorizonMinutes: 30 | 60,
): SourceAnchor[] {
  const offset = (symbol === "ETHUSDT" ? 10_000 : 0) + primaryHorizonMinutes * 100_000;
  return Array.from({ length: 4_100 }, (_, index) => ({
    venue: "htx",
    market: "spot",
    symbol,
    closedBarEpochMs: (30_000_000 + offset + index) * 60_000,
    barContentDigest: digest(`${symbol}:${primaryHorizonMinutes}:bar:${index}`),
    realizedVol20m_1m: 0.005 + (index % 30) * 0.001,
    outcome13d: [
      0.001, 0.002, 0.003, (index % 11 - 5) / 1000, 0.004, 0.005, 0.006,
      100, 101, 102, 103, 104, 105,
    ],
  }));
}

function replayEvidence(
  selectedAnchors: readonly { anchorEpochMin: number }[],
): KmAnchorReplayEvidenceV2[] {
  return selectedAnchors.map((anchor, anchorIndex) => {
    const reference = {
      evLower: 0.01 + (anchorIndex % 17) / 100_000,
      evBase: 0.02 + (anchorIndex % 19) / 100_000,
      evUpper: 0.03 + (anchorIndex % 23) / 100_000,
      mcEs: 0.1 + (anchorIndex % 29) / 10_000,
    };
    return {
      anchorEpochMin: anchor.anchorEpochMin,
      reference,
      cells: [10, 20, 30, 40, 50].flatMap((kConfig) =>
        [20, 40, 80].map((mConfig) => {
          const error = 0.0005 +
            (kConfig / 50 + mConfig / 80 + (anchorIndex % 7)) / 100_000;
          return {
            kConfig,
            mConfig,
            candidate: {
              evLower: reference.evLower * (1 + error),
              evBase: reference.evBase * (1 - error),
              evUpper: reference.evUpper * (1 + error / 2),
              mcEs: reference.mcEs * (1 - error / 2),
            },
          };
        }),
      ),
    };
  });
}

function corpusSnapshot(
  symbol: "BTCUSDT" | "ETHUSDT",
  primaryHorizonMinutes: 30 | 60,
) {
  return {
    corpus: corpus(symbol, primaryHorizonMinutes),
    rawSha256Hex: digest(`development:${symbol}:raw`),
  };
}

function input() {
  return {
    runId: "run-dee-917",
    datasetRoot: "/qualified/development",
    qualificationReceiptPath: "/qualified/receipt.json",
    runtimeRequalificationReceiptPath: "/qualified/runtime.json",
    releaseSha: TARGET_RELEASE,
    organizationId: ORGANIZATION_ID,
    economics: {
      notionalUsdt: 1_000,
      costRate: 0.001,
      slippageBufferUsdt: 0.25,
      nRefUsdt: 1_000,
    },
  } as const;
}

describe("DEE-917 production four-surface authority bootstrap", () => {
  it("refuses its TEST_ONLY dependency seam outside an actual Vitest runtime", () => {
    try {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("VITEST", "true");
      expect(() => TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(
        input(), null as never,
      )).toThrow("TEST_ONLY_RUNTIME");

      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("VITEST", "false");
      expect(() => TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(
        input(), null as never,
      )).toThrow("TEST_ONLY_RUNTIME");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("derives all authority inputs internally from verified qualification and DEVELOPMENT", async () => {
    const qualification = qualificationReceipt();
    const runtime = runtimeReceipt(qualification);
    const loadDurableAuthority = vi.fn(async () => durableAuthority(qualification));
    const readQualification = vi.fn(() => qualification);
    const assertFiles = vi.fn();
    const loadCorpusSnapshot = vi.fn(async ({ symbol, primaryHorizonMinutes }: {
      symbol: "BTCUSDT" | "ETHUSDT";
      primaryHorizonMinutes: 30 | 60;
    }) => corpusSnapshot(symbol, primaryHorizonMinutes));
    const evaluate = vi.fn(({ selectedAnchors }: {
      selectedAnchors: readonly { anchorEpochMin: number }[];
    }) => replayEvidence(selectedAnchors));

    const authority = await TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(input(), {
      loadDurableAuthority,
      readQualification,
      assertQualification: () => undefined,
      assertFiles,
      readRuntimeRequalification: () => runtime,
      loadCorpusSnapshot,
      evaluate,
    });

    expect(loadDurableAuthority).toHaveBeenCalledOnce();
    expect(readQualification).toHaveBeenCalledTimes(2);
    expect(assertFiles).toHaveBeenCalledTimes(2);
    expect(loadCorpusSnapshot).toHaveBeenCalledTimes(4);
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(evaluate.mock.calls.every(([call]) => call.selectedAnchors.length === 4_096)).toBe(true);
    expect(authority).toMatchObject({
      evaluatorVersion: KM_FOUR_SURFACE_EXECUTABLE_EVALUATOR_V2,
      releaseSha: TARGET_RELEASE,
      organizationId: ORGANIZATION_ID,
      sourceQualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
      runtimeRequalificationReceiptDigestHex: runtime.requalificationReceiptDigest,
      developmentDatasetIdentityDigestHex: qualification.developmentContentDigest,
      durableDatasetAuthority: durableAuthority(qualification),
    });
    expect(authority.contract.surfaces.map((surface) => surface.surfaceKey)).toEqual([
      "BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60",
    ]);
    expect(authority.contract.surfaces.every((surface) =>
      surface.convergenceReceipt.configurations.length === 15 &&
      surface.convergenceReceipt.terminalStatus === "QUALIFIED")).toBe(true);
  });

  it("rejects a stale runtime requalification before loading or evaluating data", async () => {
    const qualification = qualificationReceipt();
    const staleRuntime = {
      ...runtimeReceipt(qualification),
      targetReleaseSha: "c".repeat(40),
    };
    const loadCorpusSnapshot = vi.fn();
    const evaluate = vi.fn();

    await expect(TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(input(), {
      loadDurableAuthority: async () => durableAuthority(qualification),
      readQualification: () => qualification,
      assertQualification: () => undefined,
      assertFiles: () => undefined,
      readRuntimeRequalification: () => staleRuntime,
      loadCorpusSnapshot,
      evaluate,
    })).rejects.toThrow("RUNTIME_REQUALIFICATION_SCOPE");
    expect(loadCorpusSnapshot).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects organization scope substitution before loading or evaluating data", async () => {
    const qualification = {
      ...qualificationReceipt(),
      organizationId: "00000000-0000-4000-8000-000000000999",
    } as FhvPreHoldoutQualificationReceiptV1;
    const loadCorpusSnapshot = vi.fn();
    const evaluate = vi.fn();

    await expect(TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(input(), {
      loadDurableAuthority: async () => ({
        ...durableAuthority(qualification),
        organizationId: input().organizationId,
      }),
      readQualification: () => qualification,
      assertQualification: () => undefined,
      assertFiles: () => undefined,
      readRuntimeRequalification: () => runtimeReceipt(qualification),
      loadCorpusSnapshot,
      evaluate,
    })).rejects.toThrow("QUALIFICATION_SCOPE");
    expect(loadCorpusSnapshot).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("requires the qualified file receipt to equal the durable authority trust root", async () => {
    const qualification = qualificationReceipt();
    const loadCorpusSnapshot = vi.fn();
    const evaluate = vi.fn();

    await expect(TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(input(), {
      loadDurableAuthority: async () => ({
        ...durableAuthority(qualification),
        qualificationReceiptDigestHex: digest("different-durable-qualification"),
      }),
      readQualification: () => qualification,
      assertQualification: () => undefined,
      assertFiles: () => undefined,
      readRuntimeRequalification: () => runtimeReceipt(qualification),
      loadCorpusSnapshot,
      evaluate,
    })).rejects.toThrow("QUALIFICATION_SCOPE");
    expect(loadCorpusSnapshot).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("re-verifies durable-qualified files after all four corpora are materialized", async () => {
    const qualification = qualificationReceipt();
    const replacement = {
      ...qualification,
      qualificationReceiptDigest: digest("replacement-qualification"),
    } as FhvPreHoldoutQualificationReceiptV1;
    const readQualification = vi.fn()
      .mockReturnValueOnce(qualification)
      .mockReturnValueOnce(replacement);
    const loadCorpusSnapshot = vi.fn(async ({ symbol, primaryHorizonMinutes }: {
      symbol: "BTCUSDT" | "ETHUSDT";
      primaryHorizonMinutes: 30 | 60;
    }) => corpusSnapshot(symbol, primaryHorizonMinutes));
    const evaluate = vi.fn();

    await expect(TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(input(), {
      loadDurableAuthority: async () => durableAuthority(qualification),
      readQualification,
      assertQualification: () => undefined,
      assertFiles: () => undefined,
      readRuntimeRequalification: () => runtimeReceipt(qualification),
      loadCorpusSnapshot,
      evaluate,
    })).rejects.toThrow("POST_CORPUS_FILE_AUTHORITY");
    expect(loadCorpusSnapshot).toHaveBeenCalledTimes(4);
    expect(readQualification).toHaveBeenCalledTimes(2);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects bytes consumed by the corpus parser when they differ from durable authority", async () => {
    const qualification = qualificationReceipt();
    const assertFiles = vi.fn();
    const evaluate = vi.fn();
    const loadCorpusSnapshot = vi.fn(async ({ symbol, primaryHorizonMinutes }: {
      symbol: "BTCUSDT" | "ETHUSDT";
      primaryHorizonMinutes: 30 | 60;
    }) => ({
      ...corpusSnapshot(symbol, primaryHorizonMinutes),
      rawSha256Hex: symbol === "BTCUSDT"
        ? digest("substituted-bytes-consumed-between-file-checks")
        : digest(`development:${symbol}:raw`),
    }));

    await expect(TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2(input(), {
      loadDurableAuthority: async () => durableAuthority(qualification),
      readQualification: () => qualification,
      assertQualification: () => undefined,
      assertFiles,
      readRuntimeRequalification: () => runtimeReceipt(qualification),
      loadCorpusSnapshot,
      evaluate,
    })).rejects.toThrow("CORPUS_RAW_AUTHORITY");
    expect(assertFiles).toHaveBeenCalledOnce();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
