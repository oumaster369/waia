import { and, eq } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import * as pgSchema from "@/db/schema.postgres";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";
import type { TraderIntelligenceCycleEnvelopeRecord } from "@/lib/trader/intelligence/records/intelligence-records.types";
import type { CycleEnvelopeRepository } from "@/lib/trader/intelligence/records/repository-adapters";
import { runIdempotentInsertWithSavepoint } from "@/lib/trader/intelligence/records/postgres-idempotent-insert";
import {
  computeCanonicalCycleCausalInputDigestV2,
  parseCanonicalCycleCausalInputBundleV2,
} from "@/lib/trader/intelligence/records/causal-input-bundle-v2";
import { CYCLE_ENVELOPE_SCHEMA_VERSION } from "@/lib/trader/intelligence/records/intelligence-records.types";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "execute">;

export function assertCausalInputIdentity(record: TraderIntelligenceCycleEnvelopeRecord): void {
  if (record.schemaVersion !== CYCLE_ENVELOPE_SCHEMA_VERSION) return;
  if (!record.inputCausalBundleJson) {
    throw new IntelligenceRecordsIdempotencyConflictError("v2 cycle envelope missing causal input bundle");
  }
  const bundle = parseCanonicalCycleCausalInputBundleV2(record.inputCausalBundleJson);
  if (computeCanonicalCycleCausalInputDigestV2(bundle) !== record.inputSemanticDigest) {
    throw new IntelligenceRecordsIdempotencyConflictError("cycle causal input bundle digest mismatch");
  }
  if (
    bundle.scope.organizationId !== record.organizationId ||
    bundle.scope.instrumentId !== record.symbol ||
    bundle.scope.evaluatedAt !== record.evaluatedAt ||
    bundle.policyProfiles.historicalProfileId !== record.historicalProfileId ||
    bundle.policyProfiles.historicalProfileContentDigest !== record.historicalProfileDigest ||
    bundle.policyProfiles.timeframeEvidenceAuthorityMatrixContentDigest !== record.matrixDigest
  ) {
    throw new IntelligenceRecordsIdempotencyConflictError(
      "cycle causal input bundle is not bound to envelope scope or policy profiles",
    );
  }
}

function mapRow(
  row: typeof pgSchema.traderIntelligenceCycleEnvelope.$inferSelect,
): TraderIntelligenceCycleEnvelopeRecord {
  const record: TraderIntelligenceCycleEnvelopeRecord = {
    id: row.id,
    organizationId: row.organizationId,
    runId: row.runId,
    cycleId: row.cycleId,
    symbol: row.symbol,
    evaluatedAt: row.evaluatedAt.toISOString(),
    historicalProfileId: row.historicalProfileId,
    historicalProfileDigest: row.historicalProfileDigest,
    matrixDigest: row.matrixDigest,
    terminalReasonCode: row.terminalReasonCode,
    inputCausalBundleJson: row.inputCausalBundleJson,
    inputSemanticDigest: row.inputSemanticDigest,
    outputSemanticDigest: row.outputSemanticDigest,
    contentDigest: row.contentDigest,
    schemaVersion: row.schemaVersion as TraderIntelligenceCycleEnvelopeRecord["schemaVersion"],
  };
  assertCausalInputIdentity(record);
  return record;
}

function assertIdempotentMatch(
  existing: TraderIntelligenceCycleEnvelopeRecord,
  incoming: TraderIntelligenceCycleEnvelopeRecord,
): void {
  if (
    existing.id !== incoming.id ||
    existing.organizationId !== incoming.organizationId ||
    existing.runId !== incoming.runId ||
    existing.cycleId !== incoming.cycleId ||
    existing.symbol !== incoming.symbol ||
    existing.schemaVersion !== incoming.schemaVersion ||
    existing.contentDigest !== incoming.contentDigest
  ) {
    throw new IntelligenceRecordsIdempotencyConflictError(
      "cycle envelope business key conflict with mismatched identity or digest",
    );
  }
}

export function createCycleEnvelopeRepositoryPostgres(ex: PgExecutor): CycleEnvelopeRepository {
  return {
    async findByBusinessKey(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderIntelligenceCycleEnvelope)
        .where(
          and(
            orgScopedWhere(pgSchema.traderIntelligenceCycleEnvelope.organizationId, scoped),
            eq(pgSchema.traderIntelligenceCycleEnvelope.runId, key.runId),
            eq(pgSchema.traderIntelligenceCycleEnvelope.cycleId, key.cycleId),
            eq(pgSchema.traderIntelligenceCycleEnvelope.symbol, key.symbol),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async insert(context, record) {
      assertCausalInputIdentity(record);
      const scoped = requireOrgContext(context.organizationId);
      const existing = await this.findByBusinessKey(context, {
        runId: record.runId,
        cycleId: record.cycleId,
        symbol: record.symbol,
      });
      if (existing) {
        assertIdempotentMatch(existing, record);
        return;
      }

      const insertResult = await runIdempotentInsertWithSavepoint(
        ex,
        "cycle_envelope",
        async () => {
          await ex.insert(pgSchema.traderIntelligenceCycleEnvelope).values({
            id: record.id,
            organizationId: scoped.organizationId,
            runId: record.runId,
            cycleId: record.cycleId,
            symbol: record.symbol,
            evaluatedAt: new Date(record.evaluatedAt),
            historicalProfileId: record.historicalProfileId,
            historicalProfileDigest: record.historicalProfileDigest,
            matrixDigest: record.matrixDigest,
            terminalReasonCode: record.terminalReasonCode,
            inputCausalBundleJson: record.inputCausalBundleJson,
            inputSemanticDigest: record.inputSemanticDigest,
            outputSemanticDigest: record.outputSemanticDigest,
            contentDigest: record.contentDigest,
            schemaVersion: record.schemaVersion,
          });
        },
      );

      if (insertResult === "unique_violation") {
        const raced = await this.findByBusinessKey(context, {
          runId: record.runId,
          cycleId: record.cycleId,
          symbol: record.symbol,
        });
        if (!raced) {
          throw new IntelligenceRecordsIdempotencyConflictError(
            "cycle envelope conflict without existing row",
          );
        }
        assertIdempotentMatch(raced, record);
      }
    },
  };
}
