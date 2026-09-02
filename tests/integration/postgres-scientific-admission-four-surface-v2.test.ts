import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildHistoricalForecastFamilyV2 } from
  "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  computePredictivePackageGenerationIdentityDigest,
  computeReplicaRootFamilyIdentityDigest,
  digestHex,
} from "@/lib/trader/intelligence/forecast-v2/identity-digests";
import {
  buildKmConvergenceReceiptV1,
  computeKmGlobalAnchorSetDigest,
  KM_GRID_K,
  KM_GRID_M,
} from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import type { KmFourSurfaceProductionAuthorityV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";
import { INTERNAL_buildScientificAdmissionFourSurfaceV2 } from
  "@/lib/trader/research/execopp-qualification/scientific-admission-four-surface-v2";
import {
  INTERNAL_persistScientificAdmissionFourSurfaceV2,
  requireScientificAdmissionFourSurfaceForOrganizationV2,
} from
  "@/lib/trader/research/execopp-qualification/scientific-admission-four-surface-repository-postgres-v2";

const explicitlyEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const parsed = (() => {
  try { return url ? new URL(url) : null; } catch { return null; }
})();
const databaseName = parsed?.pathname.replace(/^\//, "") ?? "";
const disposable = Boolean(
  parsed && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) &&
  ["waia_it", "waia_validate"].includes(databaseName),
);

if (explicitlyEnabled && url && !disposable) {
  throw new Error(
    "DEE918_PG_INTEGRATION_REFUSED: requires local disposable waia_it/waia_validate",
  );
}

const RELEASE_SHA = "9".repeat(40);
const SURFACES = [
  { symbol: "BTCUSDT" as const, primaryHorizonMinutes: 30 as const },
  { symbol: "BTCUSDT" as const, primaryHorizonMinutes: 60 as const },
  { symbol: "ETHUSDT" as const, primaryHorizonMinutes: 30 as const },
  { symbol: "ETHUSDT" as const, primaryHorizonMinutes: 60 as const },
] as const;

function digest(label: string): string {
  return computeSemanticSha256Hex({ label });
}

function authorityFixture(
  organizationId: string,
  runId: string,
): KmFourSurfaceProductionAuthorityV2 {
  const datasetDigest = digest("dataset");
  const surfaceAnchorDigests = SURFACES.map((surface) =>
    Buffer.from(digest(`${surface.symbol}:${surface.primaryHorizonMinutes}:anchors`), "hex"));
  const globalAnchorSetDigestHex =
    computeKmGlobalAnchorSetDigest(surfaceAnchorDigests).toString("hex");
  const surfaces = SURFACES.map((surface, index) => {
    const family = buildHistoricalForecastFamilyV2({
      organizationId,
      symbol: surface.symbol,
      primaryHorizonMinutes: surface.primaryHorizonMinutes,
      developmentDatasetDigestHex: datasetDigest,
      releaseSha: RELEASE_SHA,
    });
    const familyIdentityDigestHex = digestHex(computeReplicaRootFamilyIdentityDigest(family));
    const configurations = KM_GRID_K.flatMap((kConfig) =>
      KM_GRID_M.map((mConfig) => ({
        kConfig, mConfig,
        evLowerRelativeErrorP95: 0.001,
        evBaseRelativeErrorP95: 0.001,
        evUpperRelativeErrorP95: 0.001,
        mcEsRelativeErrorP95: 0.001,
        qualifies: true,
      })),
    );
    const candidateGenerationDigestsHex = configurations.map(({ kConfig, mConfig }) =>
      digestHex(computePredictivePackageGenerationIdentityDigest({
        replicaRootFamilyIdentityDigestHex: familyIdentityDigestHex,
        kConfigDec: kConfig,
        mConfigDec: mConfig,
        alphaEpiConfigScale8: "0.10000000",
      })));
    const convergenceReceipt = buildKmConvergenceReceiptV1({
      replicaRootFamilyIdentityDigestHex: familyIdentityDigestHex,
      kmGlobalAnchorSetDigestHex: globalAnchorSetDigestHex,
      candidateGenerationDigestsHex,
      configurations,
      selectedPackageGenerationIdentityDigestHex: candidateGenerationDigestsHex[0],
      selectedPackageContentDigestHex: digest(`package:${index}`),
    });
    const surfaceBody = {
      surfaceKey: `${surface.symbol}:${surface.primaryHorizonMinutes}`,
      ...surface,
      family,
      familyIdentityDigestHex,
      developmentCorpusContentDigestHex: digest(`corpus:${index}`),
      selectedAnchorCount: 4_096 as const,
      surfaceAnchorSetDigestHex: surfaceAnchorDigests[index]!.toString("hex"),
      globalAnchorSetDigestHex,
      replayEvidenceContentDigestHex: digest(`replay:${index}`),
      convergenceReceipt,
    };
    return Object.freeze({
      ...surfaceBody,
      contentDigestHex: computeSemanticSha256Hex(surfaceBody),
    });
  });
  const contractBody = {
    schemaVersion: "km-four-surface-contract/v2" as const,
    organizationId,
    developmentDatasetDigestHex: datasetDigest,
    developmentAuthorityContentDigestHex: digest("development-authority"),
    surfaces,
    globalAnchorSetDigestHex,
  };
  const contract = Object.freeze({
    ...contractBody,
    contentDigestHex: computeSemanticSha256Hex(contractBody),
  });
  const qualificationDigest = digest("qualification");
  const authorityBody = {
    schemaVersion: "km-four-surface-production-authority/v2" as const,
    evaluatorVersion: "km-four-surface-executable-evaluator/v2" as const,
    releaseSha: RELEASE_SHA,
    organizationId,
    sourceQualificationReceiptDigestHex: qualificationDigest,
    runtimeRequalificationReceiptDigestHex: null,
    developmentDatasetIdentityDigestHex: datasetDigest,
    durableDatasetAuthority: {
      organizationId,
      runId,
      qualificationReceiptDigestHex: qualificationDigest,
      authorityRowCount: 2,
      cycleIds: [
        `${runId}:DEVELOPMENT:BTCUSDT:0`,
        `${runId}:DEVELOPMENT:ETHUSDT:0`,
      ],
      developmentSymbols: ["BTCUSDT", "ETHUSDT"] as const,
      developmentPartitionRawSha256Hex: {
        BTCUSDT: digest("btc-raw"), ETHUSDT: digest("eth-raw"),
      },
      authoritySetContentDigestHex: digest("durable-authority-set"),
    },
    economics: {
      notionalUsdt: 1_000, costRate: 0.001, slippageBufferUsdt: 0.25, nRefUsdt: 1_000,
    },
    contract,
  };
  return Object.freeze({
    ...authorityBody,
    contentDigestHex: computeSemanticSha256Hex(authorityBody),
  });
}

describe.skipIf(!explicitlyEnabled || !url || !disposable)(
  "DEE-918 ScientificAdmission PostgreSQL persistence race",
  () => {
    const sql = postgres(url!, { max: 8 });
    const userId = randomUUID();
    const organizationId = randomUUID();

    beforeAll(async () => {
      const [migration] = await sql<{ relation: string | null }[]>`
        SELECT to_regclass('public.trader_scientific_admission_receipt_v1')::text AS relation
      `;
      expect(migration?.relation).toBe("trader_scientific_admission_receipt_v1");
      await sql`INSERT INTO auth.users (id) VALUES (${userId}::uuid)`;
      await sql`INSERT INTO users (id, identity_label, email)
        VALUES (${userId}::uuid, 'DEE-918 PostgreSQL integration',
          ${`dee-918-${userId}@invalid.local`})`;
      await sql`INSERT INTO organizations (id, owner_user_id, kind, name)
        VALUES (${organizationId}::uuid, ${userId}::uuid, 'personal',
          'DEE-918 PostgreSQL integration')`;
    });

    afterAll(async () => {
      await sql.end({ timeout: 5 });
    });

    it("converges concurrent inserts and replays the exact admission in its organization", async () => {
      const authority = authorityFixture(organizationId, `dee-918-race-${randomUUID()}`);
      const results = await Promise.all(Array.from({ length: 4 }, () =>
        INTERNAL_persistScientificAdmissionFourSurfaceV2(sql, authority)));
      expect(results.filter((result) => result.insertedNew)).toHaveLength(1);
      expect(new Set(results.map((result) => result.id)).size).toBe(1);

      const receipt = INTERNAL_buildScientificAdmissionFourSurfaceV2(authority);
      await expect(requireScientificAdmissionFourSurfaceForOrganizationV2(sql, {
        organizationId,
        releaseSha: receipt.releaseSha,
        runId: receipt.runId,
        developmentDatasetIdentityDigestHex: receipt.developmentDatasetIdentityDigestHex,
        sourceQualificationReceiptDigestHex: receipt.sourceQualificationReceiptDigestHex,
        sourceFourSurfaceAuthorityContentDigestHex:
          receipt.sourceFourSurfaceAuthorityContentDigestHex,
        evidenceSemanticDigestHex: receipt.evidenceSemanticDigestHex,
      })).resolves.toEqual(receipt);
    });
  },
);
