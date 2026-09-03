import { createHash } from "node:crypto";
import type postgres from "postgres";

import { withPostgresSessionTransaction } from "@/db/postgres-session-transaction";
import { canonicalizeSemanticJsonString, computeSemanticSha256Hex } from
  "@/lib/trader/intelligence/htr-semantic-canonical-json";

export const HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_V2 =
  "waia.trader.historical_forecast_knowledge_bootstrap.v2" as const;

export type HistoricalForecastKnowledgeBootstrapV2 = Readonly<{
  schemaVersion: typeof HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_V2;
  organizationId: string;
  knowledgeEdgeId: string;
  fromRef: string;
  toRef: string;
  relationKind: "predictive_package_models_symbol_horizon";
  confidence: "0.50000000";
  strength: "0.00000000";
  regimeScope: "ALL";
  failureCasesJson: "[]";
  verified: false;
  contentDigestHex: string;
}>;

export type HistoricalForecastKnowledgeDurableRowV2 = Readonly<{
  from_ref: string;
  to_ref: string;
  relation_kind: string;
  confidence: string;
  strength: string;
  regime_scope: string;
  failure_cases_json: string;
  hypothesis_id: string | null;
  verified: boolean;
}>;

export function assertHistoricalForecastKnowledgeBootstrapDurableRowV2(
  expected: HistoricalForecastKnowledgeBootstrapV2,
  row: HistoricalForecastKnowledgeDurableRowV2 | undefined,
): void {
  if (
    !row ||
    row.from_ref !== expected.fromRef ||
    row.to_ref !== expected.toRef ||
    row.relation_kind !== expected.relationKind ||
    row.confidence !== expected.confidence ||
    row.strength !== expected.strength ||
    row.regime_scope !== expected.regimeScope ||
    row.failure_cases_json !== expected.failureCasesJson ||
    row.hypothesis_id !== null ||
    row.verified !== expected.verified
  ) {
    throw new Error(
      "HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:DURABLE_LINEAGE",
    );
  }
}

function uuidFromDigest(digest: string): string {
  const chars = digest.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = "8";
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** A neutral, unverified model-claim edge makes cold start explicit instead of inventing prior learning. */
export function buildHistoricalForecastKnowledgeBootstrapV2(input: Readonly<{
  organizationId: string;
  symbol: string;
  horizonMinutes: number;
  predictivePackageContentDigestHex: string;
}>): HistoricalForecastKnowledgeBootstrapV2 {
  if (!input.organizationId.trim() || !input.symbol.trim() ||
      !Number.isSafeInteger(input.horizonMinutes) || input.horizonMinutes <= 0 ||
      !/^[0-9a-f]{64}$/.test(input.predictivePackageContentDigestHex)) {
    throw new Error("HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:IDENTITY");
  }
  const identityDigest = createHash("sha256").update(canonicalizeSemanticJsonString({
    schemaVersion: HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_V2,
    organizationId: input.organizationId,
    symbol: input.symbol,
    horizonMinutes: input.horizonMinutes,
    predictivePackageContentDigestHex: input.predictivePackageContentDigestHex,
  })).digest("hex");
  const body = {
    schemaVersion: HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_V2,
    organizationId: input.organizationId,
    knowledgeEdgeId: uuidFromDigest(identityDigest),
    fromRef: `predictive-package:${input.predictivePackageContentDigestHex}`,
    toRef: `market-horizon:${input.symbol}:${input.horizonMinutes}m`,
    relationKind: "predictive_package_models_symbol_horizon" as const,
    confidence: "0.50000000" as const,
    strength: "0.00000000" as const,
    regimeScope: "ALL" as const,
    failureCasesJson: "[]" as const,
    verified: false as const,
  };
  return Object.freeze({ ...body, contentDigestHex: computeSemanticSha256Hex(body) });
}

/** Idempotently persists only the exact neutral cold-start edge; conflicting bytes fail closed. */
export async function persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(
  sql: postgres.Sql,
  edge: HistoricalForecastKnowledgeBootstrapV2,
): Promise<Readonly<{ insertedNew: boolean }>> {
  const rebuilt = buildHistoricalForecastKnowledgeBootstrapV2({
    organizationId: edge.organizationId,
    symbol: edge.toRef.split(":")[1] ?? "",
    horizonMinutes: Number((edge.toRef.split(":")[2] ?? "").replace(/m$/, "")),
    predictivePackageContentDigestHex: edge.fromRef.replace(/^predictive-package:/, ""),
  });
  if (canonicalizeSemanticJsonString(rebuilt) !== canonicalizeSemanticJsonString(edge)) {
    throw new Error("HISTORICAL_FORECAST_KNOWLEDGE_BOOTSTRAP_REFUSED:CONTENT");
  }
  await sql`
    SELECT pg_advisory_xact_lock(
      hashtextextended(${edge.organizationId + "|" + edge.knowledgeEdgeId}, 903)
    )
  `;
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO trader_knowledge_edges
      (id,organization_id,from_ref,to_ref,relation_kind,confidence,strength,regime_scope,
       failure_cases_json,hypothesis_id,verified)
    VALUES (${edge.knowledgeEdgeId}::uuid,${edge.organizationId}::uuid,${edge.fromRef},${edge.toRef},
      ${edge.relationKind},${edge.confidence},${edge.strength},${edge.regimeScope},
      ${edge.failureCasesJson},NULL,false)
    ON CONFLICT (id) DO NOTHING
    RETURNING id::text AS id
  `;
  const rows = await sql<HistoricalForecastKnowledgeDurableRowV2[]>`
    SELECT from_ref,to_ref,relation_kind,confidence,strength,regime_scope,
           failure_cases_json,hypothesis_id::text AS hypothesis_id,verified
    FROM trader_knowledge_edges WHERE organization_id=${edge.organizationId}::uuid
      AND id=${edge.knowledgeEdgeId}::uuid
    FOR SHARE
  `;
  assertHistoricalForecastKnowledgeBootstrapDurableRowV2(edge, rows[0]);
  return Object.freeze({ insertedNew: inserted.length === 1 });
}

/** Standalone entry point; nested callers reuse their exact held PostgreSQL transaction. */
export async function persistHistoricalForecastKnowledgeBootstrapV2(
  sql: postgres.Sql,
  edge: HistoricalForecastKnowledgeBootstrapV2,
): Promise<Readonly<{ insertedNew: boolean }>> {
  return withPostgresSessionTransaction(sql, "SERIALIZABLE", (transaction) =>
    persistHistoricalForecastKnowledgeBootstrapWithinTransactionV2(transaction, edge));
}
