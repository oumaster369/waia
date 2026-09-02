import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/source-anchor-v1";
import type { FhvPreHoldoutQualificationReceiptV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import type { FhvPreHoldoutRuntimeRequalificationV1 } from
  "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";
import {
  INTERNAL_buildScientificAdmissionFourSurfaceV2 as buildScientificAdmissionFourSurfaceV2,
  INTERNAL_requireScientificAdmissionFourSurfaceV2 as requireScientificAdmissionFourSurfaceV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-four-surface-v2";
import {
  INTERNAL_persistScientificAdmissionFourSurfaceV2 as persistScientificAdmissionFourSurfaceV2,
  requireScientificAdmissionFourSurfaceForOrganizationV2,
} from
  "@/lib/trader/research/execopp-qualification/scientific-admission-four-surface-repository-postgres-v2";
import type { KmAnchorReplayEvidenceV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-contract-v2";
import {
  TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2,
  type KmFourSurfaceDurableDatasetAuthorityV2,
  type KmFourSurfaceProductionAuthorityV2,
} from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000918";
const OTHER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000009918";
const SOURCE_RELEASE = "a".repeat(40);
const TARGET_RELEASE = "b".repeat(40);

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function qualificationReceipt(): FhvPreHoldoutQualificationReceiptV1 {
  return {
    releaseSha: SOURCE_RELEASE,
    organizationId: ORGANIZATION_ID,
    qualificationReceiptDigest: digest("qualification-918"),
    developmentContentDigest: digest("development-918"),
    developmentWalkForwardContentDigest: digest("development-walk-forward-918"),
    holdout: { status: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" },
    partitions: [
      { partition: "development", symbol: "BTCUSDT", rawSha256: digest("BTC:raw") },
      { partition: "development", symbol: "ETHUSDT", rawSha256: digest("ETH:raw") },
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
    operatorId: "dee-918-test",
    verifiedAtUtc: "2026-09-02T00:00:00.000Z",
    requalificationReceiptDigest: digest("runtime-918"),
  };
}

function durableAuthority(
  qualification: FhvPreHoldoutQualificationReceiptV1,
): KmFourSurfaceDurableDatasetAuthorityV2 {
  return {
    organizationId: ORGANIZATION_ID,
    runId: "run-dee-918",
    qualificationReceiptDigestHex: qualification.qualificationReceiptDigest,
    authorityRowCount: 2,
    cycleIds: [
      "run-dee-918:DEVELOPMENT:BTCUSDT:100",
      "run-dee-918:DEVELOPMENT:ETHUSDT:100",
    ],
    developmentSymbols: ["BTCUSDT", "ETHUSDT"],
    developmentPartitionRawSha256Hex: {
      BTCUSDT: digest("BTC:raw"),
      ETHUSDT: digest("ETH:raw"),
    },
    authoritySetContentDigestHex: digest("authority-set-918"),
  };
}

function corpus(symbol: "BTCUSDT" | "ETHUSDT", horizon: 30 | 60): SourceAnchor[] {
  const offset = (symbol === "ETHUSDT" ? 10_000 : 0) + horizon * 100_000;
  return Array.from({ length: 4_100 }, (_, index) => ({
    venue: "htx",
    market: "spot",
    symbol,
    closedBarEpochMs: (40_000_000 + offset + index) * 60_000,
    barContentDigest: digest(`${symbol}:${horizon}:${index}`),
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
  return selectedAnchors.map((anchor, index) => {
    const reference = { evLower: 0.01, evBase: 0.02, evUpper: 0.03, mcEs: 0.1 };
    return {
      anchorEpochMin: anchor.anchorEpochMin,
      reference,
      cells: [10, 20, 30, 40, 50].flatMap((kConfig) =>
        [20, 40, 80].map((mConfig) => {
          const error = 0.0005 + (kConfig + mConfig + index % 7) / 1_000_000;
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

async function buildAuthority(): Promise<KmFourSurfaceProductionAuthorityV2> {
  const qualification = qualificationReceipt();
  const runtime = runtimeReceipt(qualification);
  return TEST_ONLY_buildKmFourSurfaceProductionAuthorityV2({
    runId: "run-dee-918",
    datasetRoot: "/qualified/development",
    qualificationReceiptPath: "/qualified/receipt.json",
    runtimeRequalificationReceiptPath: "/qualified/runtime.json",
    releaseSha: TARGET_RELEASE,
    organizationId: ORGANIZATION_ID,
    economics: { notionalUsdt: 1_000, costRate: 0.001, slippageBufferUsdt: 0.25, nRefUsdt: 1_000 },
  }, {
    loadDurableAuthority: async () => durableAuthority(qualification),
    readQualification: () => qualification,
    assertQualification: () => undefined,
    assertFiles: () => undefined,
    readRuntimeRequalification: () => runtime,
    loadCorpusSnapshot: async ({ symbol, primaryHorizonMinutes }) => ({
      corpus: corpus(symbol, primaryHorizonMinutes),
      rawSha256Hex: digest(`${symbol === "BTCUSDT" ? "BTC" : "ETH"}:raw`),
    }),
    evaluate: ({ selectedAnchors }) => replayEvidence(selectedAnchors),
  });
}

function resealContractAndAuthority(authority: KmFourSurfaceProductionAuthorityV2): void {
  const mutable = authority as unknown as Record<string, unknown>;
  const contract = mutable.contract as Record<string, unknown>;
  const contractBody = { ...contract };
  delete contractBody.contentDigestHex;
  contract.contentDigestHex = computeSemanticSha256Hex(contractBody);
  const authorityBody = { ...mutable };
  delete authorityBody.contentDigestHex;
  mutable.contentDigestHex = computeSemanticSha256Hex(authorityBody);
}

function expectedFor(authority: KmFourSurfaceProductionAuthorityV2) {
  const receipt = buildScientificAdmissionFourSurfaceV2(authority);
  return {
    organizationId: receipt.organizationId,
    releaseSha: receipt.releaseSha,
    runId: receipt.runId,
    developmentDatasetIdentityDigestHex: receipt.developmentDatasetIdentityDigestHex,
    sourceQualificationReceiptDigestHex: receipt.sourceQualificationReceiptDigestHex,
    sourceFourSurfaceAuthorityContentDigestHex: receipt.sourceFourSurfaceAuthorityContentDigestHex,
    evidenceSemanticDigestHex: receipt.evidenceSemanticDigestHex,
  };
}

type FakeDurableRow = Record<string, unknown>;

function fakeSql() {
  let row: FakeDurableRow | null = null;
  let raceMode: "same" | "conflict" | null = null;
  let raceConstraintName = "tsar_v1_org_evidence_digest_uq";
  const sql = ((first: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof first === "string") return { identifier: first };
    const text = Array.from(first).join(" ? ");
    if (text.trim().startsWith("SELECT")) {
      const fragment = values.find(
        (value) => value && typeof value === "object" && "organizationId" in value,
      ) as { organizationId?: string } | undefined;
      const evidence = values.find(
        (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
      );
      return Promise.resolve(
        row && row.organization_id === fragment?.organizationId &&
          row.evidence_semantic_digest === evidence ? [row] : [],
      );
    }
    if (text.includes("INSERT INTO trader_scientific_admission_receipt_v1")) {
      row = {
        id: values[0], organization_id: values[1], receipt_kind: values[2],
        km_global_anchor_set_digest: values[3], replica_root_family_identity_digest: values[4],
        selected_k_config_dec: null, selected_m_config_dec: null,
        alpha_epi_config_scale8: values[5], selected_package_generation_identity_digest: null,
        selected_package_content_digest: null, evidence_semantic_digest: values[6],
        receipt_json: values[7], content_digest: values[8], schema_version: values[9],
      };
      if (raceMode) {
        const mode = raceMode;
        raceMode = null;
        if (mode === "conflict") row.content_digest = digest("raced-conflict");
        return Promise.reject(Object.assign(new Error("unique"), {
          code: "23505", constraint_name: raceConstraintName,
        }));
      }
      return Promise.resolve([]);
    }
    if (values[0] && typeof values[0] === "object" && "identifier" in (values[0] as object)) {
      return { organizationId: values[1] };
    }
    throw new Error(`UNEXPECTED_SQL:${text}`);
  }) as unknown as import("postgres").Sql;
  return {
    sql,
    replaceRow(next: FakeDurableRow | null) { row = next; },
    readRow() { return row; },
    raceOnNextInsert(
      mode: "same" | "conflict",
      constraintName = "tsar_v1_org_evidence_digest_uq",
    ) {
      raceMode = mode;
      raceConstraintName = constraintName;
    },
  };
}

describe("DEE-918 aggregate four-surface ScientificAdmission", () => {
  let authority: KmFourSurfaceProductionAuthorityV2;

  beforeAll(async () => {
    authority = await buildAuthority();
  }, 30_000);

  it("binds all four distinct surface families, receipts and packages", () => {
    const receipt = buildScientificAdmissionFourSurfaceV2(authority);
    expect(receipt.surfaceBindings.map((surface) => surface.surfaceKey)).toEqual([
      "BTCUSDT:30", "BTCUSDT:60", "ETHUSDT:30", "ETHUSDT:60",
    ]);
    expect(new Set(receipt.surfaceBindings.map((surface) => surface.familyIdentityDigestHex)).size)
      .toBe(4);
    expect(new Set(receipt.surfaceBindings.map(
      (surface) => surface.convergenceEvidenceSemanticDigestHex)).size).toBe(4);
    expect(receipt.authorityBoundary).toEqual({
      capitalAuthority: "NONE",
      liveTradingAuthority: "NONE",
      blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED",
      humanRatificationAuthority: "NOT_CLAIMED_BY_THIS_RECEIPT",
    });
  });

  it.each([
    ["missing", (copy: KmFourSurfaceProductionAuthorityV2) => {
      (copy.contract.surfaces as unknown as unknown[]).pop();
    }],
    ["duplicate", (copy: KmFourSurfaceProductionAuthorityV2) => {
      (copy.contract.surfaces as unknown as unknown[])[1] = copy.contract.surfaces[0];
    }],
    ["swapped", (copy: KmFourSurfaceProductionAuthorityV2) => {
      const surfaces = copy.contract.surfaces as unknown as unknown[];
      [surfaces[0], surfaces[1]] = [surfaces[1], surfaces[0]];
    }],
  ])("refuses a %s surface set even after outer resealing", (_label, mutate) => {
    const copy = structuredClone(authority);
    mutate(copy);
    resealContractAndAuthority(copy);
    expect(() => buildScientificAdmissionFourSurfaceV2(copy)).toThrow(
      "SCIENTIFIC_ADMISSION_FOUR_SURFACE_REFUSED",
    );
  });

  it("refuses cross-organization, run and release replay bindings", () => {
    const receipt = buildScientificAdmissionFourSurfaceV2(authority);
    const expected = expectedFor(authority);
    for (const mutation of [
      { organizationId: OTHER_ORGANIZATION_ID },
      { runId: "other-run" },
      { releaseSha: "c".repeat(40) },
    ]) {
      expect(() => requireScientificAdmissionFourSurfaceV2(
        receipt,
        { ...expected, ...mutation },
      )).toThrow("SCIENTIFIC_ADMISSION_FOUR_SURFACE_REFUSED:EXPECTED_BINDING");
    }
  });

  it("refuses tampered nested source and aggregate receipt content", () => {
    const nested = structuredClone(authority);
    (nested.contract.surfaces[0] as { replayEvidenceContentDigestHex: string })
      .replayEvidenceContentDigestHex = digest("tamper");
    expect(() => buildScientificAdmissionFourSurfaceV2(nested)).toThrow(
      "SCIENTIFIC_ADMISSION_FOUR_SURFACE_REFUSED",
    );

    const receipt = structuredClone(buildScientificAdmissionFourSurfaceV2(authority));
    (receipt.surfaceBindings[0] as { predictivePackageContentDigestHex: string })
      .predictivePackageContentDigestHex = digest("tamper-receipt");
    expect(() => requireScientificAdmissionFourSurfaceV2(receipt, expectedFor(authority))).toThrow(
      "SCIENTIFIC_ADMISSION_FOUR_SURFACE_REFUSED:EXPECTED_BINDING",
    );
  });

  it("persists idempotently and replays only within the expected organization", async () => {
    const store = fakeSql();
    const first = await persistScientificAdmissionFourSurfaceV2(store.sql, authority);
    expect(first.insertedNew).toBe(true);

    const retry = await persistScientificAdmissionFourSurfaceV2(store.sql, authority);
    expect(retry).toMatchObject({ id: first.id, insertedNew: false });
    await expect(requireScientificAdmissionFourSurfaceForOrganizationV2(
      store.sql, expectedFor(authority),
    )).resolves.toMatchObject({ organizationId: ORGANIZATION_ID, runId: "run-dee-918" });
    await expect(requireScientificAdmissionFourSurfaceForOrganizationV2(store.sql, {
      ...expectedFor(authority), organizationId: OTHER_ORGANIZATION_ID,
    })).rejects.toThrow("NOT_FOUND_FOR_ORGANIZATION");
  });

  it("fails closed when durable content conflicts at the same natural identity", async () => {
    const store = fakeSql();
    await persistScientificAdmissionFourSurfaceV2(store.sql, authority);
    store.replaceRow({ ...store.readRow(), content_digest: digest("durable-conflict") });
    await expect(persistScientificAdmissionFourSurfaceV2(
      store.sql, authority,
    )).rejects.toThrow("SCIENTIFIC_ADMISSION_FOUR_SURFACE_NATURAL_IDENTITY_CONFLICT");
  });

  it("converges only an exact unique-insert race and rejects a conflicting race", async () => {
    const converging = fakeSql();
    converging.raceOnNextInsert("same");
    await expect(persistScientificAdmissionFourSurfaceV2(
      converging.sql, authority,
    )).resolves.toMatchObject({ insertedNew: false });

    const conflicting = fakeSql();
    conflicting.raceOnNextInsert("conflict");
    await expect(persistScientificAdmissionFourSurfaceV2(
      conflicting.sql, authority,
    )).rejects.toThrow("SCIENTIFIC_ADMISSION_FOUR_SURFACE_NATURAL_IDENTITY_CONFLICT");

    const unrelated = fakeSql();
    unrelated.raceOnNextInsert("same", "some_other_unique_constraint");
    await expect(persistScientificAdmissionFourSurfaceV2(
      unrelated.sql, authority,
    )).rejects.toMatchObject({
      code: "23505", constraint_name: "some_other_unique_constraint",
    });
  });
});
