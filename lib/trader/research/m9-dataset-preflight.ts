import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import type { SealedResearchDatasetDigests } from "@/lib/trader/market-data/research-dataset";
import {
  getResearchDatasetByNamePostgres,
  insertResearchDatasetPostgres,
  type ResearchDatasetRecord,
} from "@/lib/trader/market-data/research-dataset-repository-postgres";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

/**
 * Same org + dataset name as an existing dataset, but different sealed content
 * (train/validation/blind digests or counts). Fail closed — never overwrite, never silently
 * pick a side (DEE-398 / ADR-0022).
 */
export class M9DatasetContentConflictError extends Error {
  readonly code = "M9_DATASET_CONTENT_CONFLICT" as const;
  readonly organizationId: string;
  readonly datasetName: string;
  readonly existingDatasetId: string;

  constructor(input: { organizationId: string; datasetName: string; existingDatasetId: string }) {
    super(
      `[m9] research dataset "${input.datasetName}" already exists for organization ` +
        `${input.organizationId} with different sealed content (existing dataset ` +
        `${input.existingDatasetId}) — repeat runs under the same dataset name must use ` +
        "identical bar content, or use a new --dataset-name",
    );
    this.name = "M9DatasetContentConflictError";
    this.organizationId = input.organizationId;
    this.datasetName = input.datasetName;
    this.existingDatasetId = input.existingDatasetId;
  }
}

export type M9DatasetPreflightCandidate = {
  symbol: InstrumentId;
  interval: BarInterval;
  sealed: SealedResearchDatasetDigests;
};

export type M9DatasetPreflightDecision =
  | { kind: "create" }
  | { kind: "reuse"; existing: ResearchDatasetRecord };

function sealedContentMatches(
  existing: ResearchDatasetRecord,
  candidate: M9DatasetPreflightCandidate,
): boolean {
  return (
    existing.symbol === candidate.symbol &&
    existing.interval === candidate.interval &&
    existing.trainBarCount === candidate.sealed.trainBarCount &&
    existing.validationBarCount === candidate.sealed.validationBarCount &&
    existing.blindBarCount === candidate.sealed.blindBarCount &&
    existing.trainDigest === candidate.sealed.trainDigest &&
    existing.validationDigest === candidate.sealed.validationDigest &&
    existing.blindDigest === candidate.sealed.blindDigest
  );
}

/**
 * Pure CREATE / REUSE / CONFLICT decision (DEE-398 / ADR-0022). No I/O — safe to unit test
 * directly. `existing` is `null` when no dataset row exists yet for `(organizationId, name)`.
 */
export function decideM9DatasetPreflight(
  existing: ResearchDatasetRecord | null,
  candidate: M9DatasetPreflightCandidate,
  scope: { organizationId: string; datasetName: string },
): M9DatasetPreflightDecision {
  if (!existing) {
    return { kind: "create" };
  }

  if (sealedContentMatches(existing, candidate)) {
    return { kind: "reuse", existing };
  }

  throw new M9DatasetContentConflictError({
    organizationId: scope.organizationId,
    datasetName: scope.datasetName,
    existingDatasetId: existing.id,
  });
}

export type ResolveM9ResearchDatasetInput = {
  id: string;
  name: string;
  symbol: InstrumentId;
  interval: BarInterval;
  sealed: SealedResearchDatasetDigests;
  metadata?: Record<string, unknown>;
  sealedAt?: Date;
};

export type ResolveM9ResearchDatasetResult = {
  dataset: ResearchDatasetRecord;
  decision: "create" | "reuse";
};

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

/**
 * Idempotent, content-addressed dataset resolution (DEE-398 / ADR-0022). Replaces an
 * unconditional insert: identical repeat runs under the same `(organizationId, name)` reuse
 * the existing dataset row (no unique-violation, no duplicate row); divergent content under
 * the same name fails closed via {@link M9DatasetContentConflictError} before any backtest
 * work runs.
 */
export async function resolveM9ResearchDatasetPostgres(
  ex: PgExecutor,
  context: OrgContext,
  input: ResolveM9ResearchDatasetInput,
): Promise<ResolveM9ResearchDatasetResult> {
  const existing = await getResearchDatasetByNamePostgres(ex, context, input.name);

  const decision = decideM9DatasetPreflight(
    existing,
    { symbol: input.symbol, interval: input.interval, sealed: input.sealed },
    { organizationId: context.organizationId, datasetName: input.name },
  );

  if (decision.kind === "reuse") {
    return { dataset: decision.existing, decision: "reuse" };
  }

  const dataset = await insertResearchDatasetPostgres(ex, context, {
    id: input.id,
    name: input.name,
    symbol: input.symbol,
    interval: input.interval,
    sealed: input.sealed,
    metadata: input.metadata,
    sealedAt: input.sealedAt,
  });
  return { dataset, decision: "create" };
}
