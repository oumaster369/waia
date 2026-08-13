import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORECAST_V2_K_MAX,
  FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE,
  FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES,
  FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES,
  FORECAST_V2_OFFICIAL_BUNDLE_COUNT,
  FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE,
} from "./storage-scale-projection";
import { FORECAST_V2_STORAGE_TABLES } from "./storage-scale-postgres-v1";

export const A3_STORAGE_CONTRACT_VERSION = "a3-storage-contract/v1" as const;

/** Human-approved DEE-518 plan SHA-256 (2026-08-10). */
export const DEE518_APPROVED_PLAN_SHA256 =
  "02c55a578333d182f7632946230b6f01662430ba5462d95c115cd6199c71a909";

export const A3_CANONICAL_N_BUNDLES = 200_000 as const;

export const A3_PACKAGE_CELLS = [
  { symbol: "BTCUSDT", horizonMinutes: 30 },
  { symbol: "BTCUSDT", horizonMinutes: 60 },
  { symbol: "ETHUSDT", horizonMinutes: 30 },
  { symbol: "ETHUSDT", horizonMinutes: 60 },
] as const;

const FORECAST_V2_MIGRATION_MIN = 110;
/**
 * Human-ratified Forecast V2 relation-era bound embedded in the canonical
 * contract digest. Physical corrective migrations after this bound must not
 * bump this value (would silently redefine a3_canonical_contract_digest).
 */
const FORECAST_V2_CANONICAL_MIGRATION_MAX = 145;
/**
 * Physical storage-surface migration upper bound (includes Closure VI repair
 * 0146/0147 and the Human-ratified forward open-tail corrective 0148 —
 * HUMAN-RATIFY-DEE-518-0148-FORWARD-CORRECTIVE-OPEN-TAILS-V1).
 * Storage surface digest MUST change when physical DDL changes; 0148 alters
 * trader_forecast_target_bucket_v2 / trader_forecast_scenario_v2 physical
 * nullability + tail_semantics, so this bound advances 147 -> 148.
 */
const FORECAST_V2_STORAGE_SURFACE_MIGRATION_MAX = 148;

const STORAGE_SURFACE_PATHS = [
  "lib/trader/intelligence/forecast-v2/storage-scale-projection.ts",
] as const;

const A3_MEASUREMENT_IMPL_SHARED_PATHS = [
  "lib/trader/intelligence/forecast-v2/a3-observed-package-surface-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-postgres-measurement-environment-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-rational-arithmetic-v1.ts",
] as const;

const PHASE01_IMPLEMENTATION_PATHS = [
  "lib/trader/intelligence/forecast-v2/a3-phase01-progress-diagnostics-v1.ts",
  ...A3_MEASUREMENT_IMPL_SHARED_PATHS,
  "lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
] as const;

const PHASE02_IMPLEMENTATION_PATHS = [
  ...A3_MEASUREMENT_IMPL_SHARED_PATHS,
  "lib/trader/intelligence/forecast-v2/a3-storage-relation-classification-v1.ts",
  "lib/trader/intelligence/forecast-v2/storage-scale-phase02-postgres-v1.ts",
  "lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
] as const;

const PHASE03_IMPLEMENTATION_PATHS = [
  "lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
] as const;

const AGGREGATE_IMPLEMENTATION_PATHS = [
  "lib/trader/intelligence/forecast-v2/a3-storage-aggregate-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-rational-arithmetic-aggregate-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1.ts",
  "lib/trader/intelligence/forecast-v2/a3-storage-invalidation-manifest-v1.ts",
] as const;

/**
 * Superseded combined digest model. Previously hashed harness sources (including
 * stall-detector edits in storage-scale-postgres-v1.ts) together with canonical
 * semantics and worktree provenance — conflating PHASE-01 implementation with
 * storage surface identity.
 */
export const A3_SUPERSEDED_COMBINED_CONTRACT_DIGEST =
  "c801e5da6f55182fed287c8b9a37e1a10aae435b2573df60c674b3707148019d";

function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function digestFile(repoRoot: string, relativePath: string): string {
  const absolute = join(repoRoot, relativePath);
  return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

function digestPaths(
  repoRoot: string,
  paths: readonly string[],
  contentOverrides?: Readonly<Record<string, string>>,
): string {
  return sha256Hex(
    paths
      .map((path) => {
        const content = contentOverrides?.[path];
        const fileDigest =
          content === undefined
            ? digestFile(repoRoot, path)
            : createHash("sha256").update(content, "utf8").digest("hex");
        return `${path}:${fileDigest}`;
      })
      .join("\n"),
  );
}

function listForecastV2StorageMigrationPaths(repoRoot: string): string[] {
  const migrationDir = join(repoRoot, "db/migrations_postgres");
  return readdirSync(migrationDir)
    .filter((name) => {
      const match = name.match(/^(\d{4})_/);
      if (!match) {
        return false;
      }
      const num = Number(match[1]);
      return num >= FORECAST_V2_MIGRATION_MIN && num <= FORECAST_V2_STORAGE_SURFACE_MIGRATION_MAX;
    })
    .sort()
    .map((name) => `db/migrations_postgres/${name}`);
}

/** Deterministic semantic digest for the four-cell worst-case package surface. */
export function computeA3PackageSurfaceSemanticDigestHex(): string {
  const lines = [
    "a3-package-surface/v1",
    `cells=${A3_PACKAGE_CELLS.length}`,
    ...A3_PACKAGE_CELLS.map((cell) => `${cell.symbol}/${cell.horizonMinutes}`),
    "packages_per_cell=1",
    "target_definitions_per_cell=2",
    "terminal_buckets_per_cell=7",
    "execution_opportunity_buckets_per_cell=0",
    "package_target_bindings_per_cell=2",
    `replicas_per_package=${FORECAST_V2_K_MAX}`,
    `replica_payload_bytes=${FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES}`,
    `raw_replica_payload_per_package=${FORECAST_V2_K_MAX * FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES}`,
  ];
  return sha256Hex(lines.join("\n"));
}

/** Expected canonical package contract digest — not DB-observed. */
export const computeExpectedPackageSurfaceDigestHex = computeA3PackageSurfaceSemanticDigestHex;

export function computeA3RelationInventoryDigestHex(): string {
  return sha256Hex([...FORECAST_V2_STORAGE_TABLES].sort().join("\n"));
}

/** A — Human-approved storage mathematics/semantics only (no harness sources). */
export function computeA3CanonicalContractDigestHex(): string {
  const body = [
    A3_STORAGE_CONTRACT_VERSION,
    `dee518_plan_sha256=${DEE518_APPROVED_PLAN_SHA256}`,
    "a3_protocol=a3-phased-storage-scale/v1",
    `canonical_n_bundles=${A3_CANONICAL_N_BUNDLES}`,
    "complete_bundle_cardinality=1",
    `package_cells=${A3_PACKAGE_CELLS.length}`,
    `k_max=${FORECAST_V2_K_MAX}`,
    `replica_payload_bytes=${FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES}`,
    `official_projection_maximum_bundles=${FORECAST_V2_OFFICIAL_BUNDLE_COUNT}`,
    "bytes_per_complete_bundle_formula=(B1-B0-package_fixed)/N",
    `max_bytes_per_complete_bundle=${FORECAST_V2_MAX_BYTES_PER_COMPLETE_BUNDLE}`,
    `max_total_projected_bytes=${FORECAST_V2_MAX_TOTAL_PROJECTED_BYTES}`,
    `proportional_rows_per_bundle=${FORECAST_V2_PROPORTIONAL_ROWS_PER_BUNDLE}`,
    "terminal_scenarios_per_bundle=7",
    "execution_opportunity_scenarios_per_bundle=0",
    "relation_classification=plan_section_5",
    "postgres_major=16",
    "postgres_validate_shm=2gb",
    `migration_range=${FORECAST_V2_MIGRATION_MIN}-${FORECAST_V2_CANONICAL_MIGRATION_MAX}`,
  ].join("\n");
  return sha256Hex(body);
}

/** B — Physical PostgreSQL surface (DDL, indexes, artifact encoding constants). */
export function computeStorageSurfaceDigestHex(repoRoot: string): string {
  const migrationPaths = listForecastV2StorageMigrationPaths(repoRoot);
  const migrationDigest = sha256Hex(
    migrationPaths.map((path) => `${path}:${digestFile(repoRoot, path)}`).join("\n"),
  );
  const projectionDigest = digestPaths(repoRoot, STORAGE_SURFACE_PATHS);
  const body = [
    "a3-storage-surface/v1",
    `migration_range=${FORECAST_V2_MIGRATION_MIN}-${FORECAST_V2_STORAGE_SURFACE_MIGRATION_MAX}`,
    `migration_digest=${migrationDigest}`,
    `projection_constants_digest=${projectionDigest}`,
    `relation_inventory_digest=${computeA3RelationInventoryDigestHex()}`,
    `package_artifact_physical_encoding=k_max=${FORECAST_V2_K_MAX};replica_payload=${FORECAST_V2_MAX_REPLICA_ARTIFACT_BYTES}`,
    `package_surface_semantic_digest=${computeA3PackageSurfaceSemanticDigestHex()}`,
  ].join("\n");
  return sha256Hex(body);
}

export function computePhase01ImplementationDigestHex(
  repoRoot: string,
  contentOverrides?: Readonly<Record<string, string>>,
): string {
  return sha256Hex(
    [
      "a3-phase01-implementation/v1",
      digestPaths(repoRoot, PHASE01_IMPLEMENTATION_PATHS, contentOverrides),
    ].join("\n"),
  );
}

export function computePhase02ImplementationDigestHex(repoRoot: string): string {
  return sha256Hex(
    ["a3-phase02-implementation/v1", digestPaths(repoRoot, PHASE02_IMPLEMENTATION_PATHS)].join(
      "\n",
    ),
  );
}

export function computePhase03ImplementationDigestHex(repoRoot: string): string {
  return sha256Hex(
    ["a3-phase03-implementation/v1", digestPaths(repoRoot, PHASE03_IMPLEMENTATION_PATHS)].join(
      "\n",
    ),
  );
}

export function computeAggregateImplementationDigestHex(repoRoot: string): string {
  return sha256Hex(
    ["a3-aggregate-implementation/v1", digestPaths(repoRoot, AGGREGATE_IMPLEMENTATION_PATHS)].join(
      "\n",
    ),
  );
}

/** D — Full dirty-tree provenance (does not auto-invalidate prior receipts). */
export function computeWorktreeProvenanceDigestHex(dirtyTreeDigestHex: string): string {
  return sha256Hex(["a3-worktree-provenance/v1", `dirty_tree=${dirtyTreeDigestHex}`].join("\n"));
}

export type A3PhaseIdentityLayersV1 = {
  schemaVersion: typeof A3_STORAGE_CONTRACT_VERSION;
  a3CanonicalContractDigest: string;
  storageSurfaceDigest: string;
  phaseImplementationDigests: {
    phase01: string;
    phase02: string;
    phase03: string;
    aggregate: string;
  };
  worktreeProvenanceDigest: string;
  localHeadCommit: string;
  packageSurfaceSemanticDigestHex: string;
  relationInventoryDigestHex: string;
};

export function computeA3PhaseIdentityLayers(input: {
  repoRoot: string;
  localHeadCommit: string;
  dirtyTreeDigestHex: string;
}): A3PhaseIdentityLayersV1 {
  return {
    schemaVersion: A3_STORAGE_CONTRACT_VERSION,
    a3CanonicalContractDigest: computeA3CanonicalContractDigestHex(),
    storageSurfaceDigest: computeStorageSurfaceDigestHex(input.repoRoot),
    phaseImplementationDigests: {
      phase01: computePhase01ImplementationDigestHex(input.repoRoot),
      phase02: computePhase02ImplementationDigestHex(input.repoRoot),
      phase03: computePhase03ImplementationDigestHex(input.repoRoot),
      aggregate: computeAggregateImplementationDigestHex(input.repoRoot),
    },
    worktreeProvenanceDigest: computeWorktreeProvenanceDigestHex(input.dirtyTreeDigestHex),
    localHeadCommit: input.localHeadCommit,
    packageSurfaceSemanticDigestHex: computeA3PackageSurfaceSemanticDigestHex(),
    relationInventoryDigestHex: computeA3RelationInventoryDigestHex(),
  };
}

/** Evidence directory keyed by canonical Human contract (stable across harness-only edits). */
export function a3EvidenceDirectory(canonicalContractDigest: string): string {
  return join("/tmp", "dee518-a3", canonicalContractDigest);
}

/** @deprecated Use computeA3PhaseIdentityLayers — superseded combined digest. */
export type A3StorageContractIdentityV1 = A3PhaseIdentityLayersV1 & {
  a3StorageContractDigest: string;
};

/** @deprecated */
export function computeA3StorageContractIdentity(input: {
  repoRoot: string;
  localHeadCommit: string;
  dirtyTreeDigestHex: string;
}): A3StorageContractIdentityV1 {
  const layers = computeA3PhaseIdentityLayers(input);
  return {
    ...layers,
    a3StorageContractDigest: layers.a3CanonicalContractDigest,
  };
}

export {
  PHASE01_IMPLEMENTATION_PATHS,
  PHASE02_IMPLEMENTATION_PATHS,
  PHASE03_IMPLEMENTATION_PATHS,
  AGGREGATE_IMPLEMENTATION_PATHS,
  STORAGE_SURFACE_PATHS,
};
