/**
 * A3 storage relation classification (PHASE-02 measurement semantics).
 *
 * Distinguishes physical schema presence on a fully migrated application DB
 * from inclusion in A3 package-fixed / proportional / enumerated_fixed_V2_other.
 *
 * Plan §5: Research/pattern/knowledge tables are FIXED GLOBAL / OUT OF SCOPE
 * for bundle projection — they MAY exist physically and MUST NOT contaminate
 * package_fixed or proportional numerators unless explicitly receipt-enumerated
 * into enumerated_fixed_V2_other.
 */

import type postgres from "postgres";

import {
  FORECAST_V2_PACKAGE_FIXED_TABLES,
  FORECAST_V2_STORAGE_TABLES,
  type ForecastV2FixedV2ClassificationItem,
} from "./storage-scale-postgres-v1";

export type A3StorageRelationClassV1 =
  | "A3_PACKAGE_FIXED_INCLUDED"
  | "A3_PROPORTIONAL_INCLUDED"
  | "ENUMERATED_FIXED_V2_OTHER_INCLUDED"
  | "RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST"
  | "LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST"
  | "PROHIBITED_UNEXPECTED_SURFACE";

/** Exact package-fixed inventory (plan §5 FIXED PER PACKAGE / FIXED PER TARGET). */
export const A3_PACKAGE_FIXED_RELATION_TABLES = FORECAST_V2_PACKAGE_FIXED_TABLES;

/** Exact proportional inventory (plan §5 PER COMPLETE BUNDLE / PER TERMINAL FORECAST). */
export const A3_PROPORTIONAL_RELATION_TABLES = [
  "trader_forecast_bundle_v2",
  "trader_forecast_v2",
  "trader_forecast_outcome_v2",
  "trader_forecast_calibration_observation_v2",
  "trader_forecast_scenario_v2",
] as const;

/**
 * Explicit closed set for enumerated_fixed_V2_other measurement.
 * Empty until a Human-ratified global/research metadata surface is receipt-enumerated.
 * Research tables listed below are OUT OF SCOPE unless moved into this set.
 */
export const A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES = [] as const;

/**
 * Known research/global tables that MAY physically exist on a fully migrated DB
 * and MUST NOT enter package_fixed / proportional / enumerated_fixed_V2_other
 * unless explicitly moved into an included inventory.
 *
 * Basis: plan §5 "Research/pattern/knowledge tables (0130–0137) FIXED GLOBAL /
 * OUT OF SCOPE" plus pre-0130 knowledge surfaces (`trader_knowledge_edges`,
 * `trader_knowledge_confidence_update_record`) that share the same OUT OF SCOPE
 * projection role.
 */
export const A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES = [
  "trader_knowledge_edges",
  "trader_knowledge_confidence_update_record",
  "trader_pattern_definition_v1",
  "trader_pattern_occurrence_v1",
  "trader_knowledge_state_checkpoint_v2",
  "trader_research_trial_registration_v1",
] as const;

/**
 * Quarantined coexistent Forecast V1 surfaces (plan WP-FORECAST-V2).
 * MAY exist on a fully migrated DB; MUST NOT enter A3 measurement inventories.
 */
export const A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES = [
  "trader_forecast_outcome_record",
] as const;

const PACKAGE_SET = new Set<string>(A3_PACKAGE_FIXED_RELATION_TABLES);
const PROPORTIONAL_SET = new Set<string>(A3_PROPORTIONAL_RELATION_TABLES);
const ENUMERATED_OTHER_SET = new Set<string>(A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES);
const RESEARCH_EXCLUDED_SET = new Set<string>(
  A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES,
);
const LEGACY_V1_EXCLUDED_SET = new Set<string>(
  A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES,
);

export function classifyA3StorageBaseTable(relname: string): A3StorageRelationClassV1 {
  if (PACKAGE_SET.has(relname)) {
    return "A3_PACKAGE_FIXED_INCLUDED";
  }
  if (PROPORTIONAL_SET.has(relname)) {
    return "A3_PROPORTIONAL_INCLUDED";
  }
  if (ENUMERATED_OTHER_SET.has(relname)) {
    return "ENUMERATED_FIXED_V2_OTHER_INCLUDED";
  }
  if (RESEARCH_EXCLUDED_SET.has(relname)) {
    return "RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST";
  }
  if (LEGACY_V1_EXCLUDED_SET.has(relname)) {
    return "LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST";
  }
  return "PROHIBITED_UNEXPECTED_SURFACE";
}

/** Indexes/TOAST are not independent semantic classes; they attach to a base table. */
export function isIndependentA3SemanticStorageSurface(input: {
  relname: string;
  relkind: string;
}): boolean {
  return input.relkind === "r";
}

export function assertA3StorageInventoriesClosedAndDisjoint(): void {
  const seen = new Map<string, A3StorageRelationClassV1>();
  const register = (relname: string, cls: A3StorageRelationClassV1): void => {
    const prior = seen.get(relname);
    if (prior !== undefined && prior !== cls) {
      throw new Error(
        `[a3-storage-classification] double-counting: ${relname} in ${prior} and ${cls}`,
      );
    }
    seen.set(relname, cls);
  };

  for (const relname of A3_PACKAGE_FIXED_RELATION_TABLES) {
    register(relname, "A3_PACKAGE_FIXED_INCLUDED");
  }
  for (const relname of A3_PROPORTIONAL_RELATION_TABLES) {
    register(relname, "A3_PROPORTIONAL_INCLUDED");
  }
  for (const relname of A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES) {
    register(relname, "ENUMERATED_FIXED_V2_OTHER_INCLUDED");
  }
  for (const relname of A3_RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST_TABLES) {
    register(relname, "RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST");
  }
  for (const relname of A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES) {
    register(relname, "LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST");
  }

  const storageUnion = new Set<string>(FORECAST_V2_STORAGE_TABLES);
  for (const relname of storageUnion) {
    if (!PACKAGE_SET.has(relname) && !PROPORTIONAL_SET.has(relname)) {
      throw new Error(
        `[a3-storage-classification] FORECAST_V2_STORAGE_TABLES entry not in package/proportional: ${relname}`,
      );
    }
  }
  for (const relname of [...PACKAGE_SET, ...PROPORTIONAL_SET]) {
    if (!storageUnion.has(relname)) {
      throw new Error(
        `[a3-storage-classification] package/proportional entry missing from FORECAST_V2_STORAGE_TABLES: ${relname}`,
      );
    }
  }
}

export function assertExcludedResearchNotInIncludedMeasurementSets(input: {
  packageFixedTables?: readonly string[];
  proportionalTables?: readonly string[];
  enumeratedFixedV2OtherTables?: readonly string[];
}): void {
  const packageTables = input.packageFixedTables ?? A3_PACKAGE_FIXED_RELATION_TABLES;
  const proportionalTables = input.proportionalTables ?? A3_PROPORTIONAL_RELATION_TABLES;
  const enumeratedOther =
    input.enumeratedFixedV2OtherTables ?? A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES;

  const forbidden = new Set<string>([...RESEARCH_EXCLUDED_SET, ...LEGACY_V1_EXCLUDED_SET]);
  const contaminate = (setName: string, tables: readonly string[]): void => {
    const hit = tables.filter((t) => forbidden.has(t));
    if (hit.length > 0) {
      throw new Error(
        `[a3-storage-classification] excluded research/legacy surface contaminated ${setName}: ${hit.join(",")}`,
      );
    }
  };

  contaminate("package-fixed", packageTables);
  contaminate("proportional", proportionalTables);
  contaminate("enumerated_fixed_V2_other", enumeratedOther);
}

export function enumerateA3FixedV2ClassificationItems(): ForecastV2FixedV2ClassificationItem[] {
  const items: ForecastV2FixedV2ClassificationItem[] = [];
  for (const surface of A3_PROPORTIONAL_RELATION_TABLES) {
    items.push({ surface, category: "bundle-proportional" });
  }
  for (const surface of A3_PACKAGE_FIXED_RELATION_TABLES) {
    items.push({ surface, category: "active-package-fixed" });
  }
  for (const surface of A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES) {
    items.push({ surface, category: "other-fixed-v2" });
  }
  items.push({
    surface:
      "research/pattern/knowledge tables (migrations 0130–0137 + knowledge edges/confidence)",
    category: "excluded-by-plan",
    scopeReason:
      "plan §5 relation cardinality: FIXED GLOBAL / OUT OF SCOPE for bundle projection; physical presence allowed on fully migrated DB",
  });
  return items;
}

/**
 * Closed-world scan of A3-relevant public base tables.
 *
 * Scans:
 * - Forecast V2 tables (`trader_forecast_%_v2`) — must be in an included inventory
 * - Explicit quarantined Forecast V1 coexistence tables
 * - Research/pattern/knowledge/trial prefixes
 *
 * Does NOT wildcard-scan all `trader_forecast_%` (that would confuse V1 coexistence
 * with unexpected V2 growth). Indexes are ignored as independent semantic surfaces.
 */
export async function assertA3ClosedWorldStorageSurfaces(sql: postgres.Sql): Promise<{
  allowedResearchPresent: readonly string[];
  allowedLegacyV1Present: readonly string[];
  unexpectedSurfaces: readonly string[];
}> {
  assertA3StorageInventoriesClosedAndDisjoint();
  assertExcludedResearchNotInIncludedMeasurementSets({});

  const knownForecastTables = [
    ...FORECAST_V2_STORAGE_TABLES,
    ...A3_LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST_TABLES,
  ] as unknown as string[];

  const rows = await sql<{ relname: string; relkind: string }[]>`
    SELECT c.relname, c.relkind::text AS relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND (
        c.relname = ANY(${knownForecastTables})
        OR c.relname LIKE 'trader_forecast_%\\_v2' ESCAPE '\\'
        OR c.relname LIKE 'trader_pattern%'
        OR c.relname LIKE 'trader_knowledge%'
        OR c.relname LIKE 'trader_research_trial%'
      )
    ORDER BY c.relname
  `;

  const allowedResearchPresent: string[] = [];
  const allowedLegacyV1Present: string[] = [];
  const unexpectedSurfaces: string[] = [];

  for (const row of rows) {
    if (!isIndependentA3SemanticStorageSurface(row)) {
      continue;
    }
    const cls = classifyA3StorageBaseTable(row.relname);
    if (cls === "RESEARCH_GLOBAL_EXCLUDED_BUT_ALLOWED_TO_EXIST") {
      allowedResearchPresent.push(row.relname);
      continue;
    }
    if (cls === "LEGACY_FORECAST_V1_QUARANTINED_ALLOWED_TO_EXIST") {
      allowedLegacyV1Present.push(row.relname);
      continue;
    }
    if (
      cls === "A3_PACKAGE_FIXED_INCLUDED" ||
      cls === "A3_PROPORTIONAL_INCLUDED" ||
      cls === "ENUMERATED_FIXED_V2_OTHER_INCLUDED"
    ) {
      continue;
    }
    unexpectedSurfaces.push(row.relname);
  }

  if (unexpectedSurfaces.length > 0) {
    throw new Error(
      `[a3-storage-classification] unexpected unclassified V2/research storage surfaces: ${unexpectedSurfaces.join(",")}`,
    );
  }

  return { allowedResearchPresent, allowedLegacyV1Present, unexpectedSurfaces };
}

/**
 * Authoritative PHASE-02 enumerated_fixed_V2_other measurement.
 *
 * Does NOT fail merely because known excluded research/global tables exist.
 * Does fail closed on: inventory contamination, unexpected surfaces, or
 * attempting to measure an excluded research table as other-fixed-v2.
 */
export async function measureEnumeratedFixedV2OtherEvidenceV1(sql: postgres.Sql): Promise<{
  items: ForecastV2FixedV2ClassificationItem[];
  enumeratedFixedV2OtherBytes: number;
  measuredSurfaces: readonly { surface: string; totalBytes: number }[];
  allowedResearchPresent: readonly string[];
  allowedLegacyV1Present: readonly string[];
}> {
  const closed = await assertA3ClosedWorldStorageSurfaces(sql);
  const items = enumerateA3FixedV2ClassificationItems();
  const measuredSurfaces: { surface: string; totalBytes: number }[] = [];

  for (const surface of A3_ENUMERATED_FIXED_V2_OTHER_RELATION_TABLES) {
    if (RESEARCH_EXCLUDED_SET.has(surface) || LEGACY_V1_EXCLUDED_SET.has(surface)) {
      throw new Error(
        `[a3-storage-classification] excluded research/legacy surface contaminated enumerated_fixed_V2_other: ${surface}`,
      );
    }
    const rows = await sql<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = ${surface}
    `;
    if (rows.length === 0) {
      measuredSurfaces.push({ surface, totalBytes: 0 });
      continue;
    }
    const sizeRows = await sql<{ total_bytes: string }[]>`
      SELECT pg_total_relation_size(${surface}::regclass)::text AS total_bytes
    `;
    measuredSurfaces.push({
      surface,
      totalBytes: Number(sizeRows[0]?.total_bytes ?? 0),
    });
  }

  const enumeratedFixedV2OtherBytes = measuredSurfaces.reduce(
    (acc, row) => acc + row.totalBytes,
    0,
  );

  return {
    items,
    enumeratedFixedV2OtherBytes,
    measuredSurfaces,
    allowedResearchPresent: closed.allowedResearchPresent,
    allowedLegacyV1Present: closed.allowedLegacyV1Present,
  };
}

/** Aggregate projection terms are added exactly once (no double-count). */
export function computeA3TotalProjectedBytesTerms(input: {
  totalCompleteBundles: number;
  bytesPerCompleteBundle: number;
  packageFixedContributionBytes: number;
  enumeratedFixedV2OtherBytes: number;
}): {
  proportionalTermBytes: number;
  packageFixedContributionBytes: number;
  enumeratedFixedV2OtherBytes: number;
  totalProjectedBytes: number;
} {
  const proportionalTermBytes = input.totalCompleteBundles * input.bytesPerCompleteBundle;
  return {
    proportionalTermBytes,
    packageFixedContributionBytes: input.packageFixedContributionBytes,
    enumeratedFixedV2OtherBytes: input.enumeratedFixedV2OtherBytes,
    totalProjectedBytes:
      proportionalTermBytes +
      input.packageFixedContributionBytes +
      input.enumeratedFixedV2OtherBytes,
  };
}
