import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  assertAccountingIdempotency,
  computeAccountingSemanticDigest,
} from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import type { AccountingFrontierV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  accountingFrontierToRow,
  accountingRowToFrontier,
} from "@/lib/trader/accounting/accounting-frontier-serialization";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type AppendAccountingFrontierInput = AccountingFrontierV1;

export type AccountingFrontierRepository = {
  loadLatest(
    context: OrgContext,
    key: { accountKey: string; runId: string },
  ): Promise<AccountingFrontierV1 | null>;
  append(context: OrgContext, input: AppendAccountingFrontierInput): Promise<AccountingFrontierV1>;
};

function mapRow(
  row: typeof pgSchema.traderAccountingFrontier.$inferSelect,
  consumedFillIds: string[],
): AccountingFrontierV1 {
  return accountingRowToFrontier(
    {
      id: row.id,
      organizationId: row.organizationId,
      accountKey: row.accountKey,
      runId: row.runId,
      accountingSequence: Number(row.accountingSequence),
      frontierAsOf: row.frontierAsOf.toISOString(),
      cash: row.cash,
      positionQuantityJson: row.positionQuantityJson as Record<string, string>,
      grossPositionBasisJson: row.grossPositionBasisJson as Record<string, string>,
      netPositionBasisJson: row.netPositionBasisJson as Record<string, string>,
      grossRealizedPnl: row.grossRealizedPnl,
      netRealizedPnl: row.netRealizedPnl,
      marksJson: row.marksJson as AccountingFrontierV1["marks"],
      equity: row.equity,
      equityHwm: row.equityHwm,
      accountDrawdownBps: row.accountDrawdownBps,
      sourceFillId: row.sourceFillId,
      sourceEconomicsDigest: row.sourceEconomicsDigest,
      semanticContentDigest: row.semanticContentDigest,
      idempotencyKey: row.idempotencyKey,
      schemaVersion: row.schemaVersion,
    },
    consumedFillIds,
  );
}

export async function loadLatestAccountingFrontier(
  repository: AccountingFrontierRepository,
  context: OrgContext,
  key: { accountKey: string; runId: string },
): Promise<AccountingFrontierV1 | null> {
  return repository.loadLatest(context, key);
}

export async function appendAccountingFrontier(
  repository: AccountingFrontierRepository,
  context: OrgContext,
  input: AppendAccountingFrontierInput,
): Promise<AccountingFrontierV1> {
  return repository.append(context, input);
}

export function createAccountingFrontierRepositoryPostgres(
  ex: PgReadExecutor & PgWriteExecutor,
): AccountingFrontierRepository {
  return {
    async loadLatest(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderAccountingFrontier)
        .where(
          and(
            orgScopedWhere(pgSchema.traderAccountingFrontier.organizationId, scoped),
            eq(pgSchema.traderAccountingFrontier.accountKey, key.accountKey),
            eq(pgSchema.traderAccountingFrontier.runId, key.runId),
          ),
        )
        .orderBy(desc(pgSchema.traderAccountingFrontier.accountingSequence))
        .limit(1);
      if (!rows[0]) {
        return null;
      }
      return mapRow(rows[0], []);
    },

    async append(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const digest = input.semanticContentDigest ?? computeAccountingSemanticDigest(input);
      const row = accountingFrontierToRow({ ...input, semanticContentDigest: digest });

      const existingByKey = await ex
        .select()
        .from(pgSchema.traderAccountingFrontier)
        .where(
          and(
            orgScopedWhere(pgSchema.traderAccountingFrontier.organizationId, scoped),
            eq(pgSchema.traderAccountingFrontier.idempotencyKey, row.idempotencyKey),
          ),
        )
        .limit(1);

      if (existingByKey[0]) {
        assertAccountingIdempotency(
          existingByKey[0].semanticContentDigest,
          digest,
          row.idempotencyKey,
        );
        return mapRow(existingByKey[0], input.consumedFillIds);
      }

      await ex.insert(pgSchema.traderAccountingFrontier).values({
        id: row.id,
        organizationId: scoped.organizationId,
        accountKey: row.accountKey,
        runId: row.runId,
        accountingSequence: BigInt(row.accountingSequence),
        frontierAsOf: new Date(row.frontierAsOf),
        cash: row.cash,
        positionQuantityJson: row.positionQuantityJson,
        grossPositionBasisJson: row.grossPositionBasisJson,
        netPositionBasisJson: row.netPositionBasisJson,
        grossRealizedPnl: row.grossRealizedPnl,
        netRealizedPnl: row.netRealizedPnl,
        marksJson: row.marksJson,
        equity: row.equity,
        equityHwm: row.equityHwm,
        accountDrawdownBps: row.accountDrawdownBps,
        sourceFillId: row.sourceFillId,
        sourceEconomicsDigest: row.sourceEconomicsDigest,
        semanticContentDigest: digest,
        idempotencyKey: row.idempotencyKey,
        schemaVersion: row.schemaVersion,
      });

      const rows = await ex
        .select()
        .from(pgSchema.traderAccountingFrontier)
        .where(
          and(
            eq(pgSchema.traderAccountingFrontier.id, row.id),
            orgScopedWhere(pgSchema.traderAccountingFrontier.organizationId, scoped),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        throw new Error("[wp18] accounting frontier insert failed");
      }
      return mapRow(rows[0], input.consumedFillIds);
    },
  };
}

export function createAccountingFrontierRepositoryMemory(): AccountingFrontierRepository {
  const store = new Map<string, AccountingFrontierV1>();

  return {
    async loadLatest(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const prefix = `${scoped.organizationId}:${key.accountKey}:${key.runId}:`;
      let latest: AccountingFrontierV1 | null = null;
      for (const [k, frontier] of store.entries()) {
        if (!k.startsWith(prefix)) continue;
        if (!latest || frontier.accountingSequence > latest.accountingSequence) {
          latest = frontier;
        }
      }
      return latest;
    },

    async append(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const digest = input.semanticContentDigest ?? computeAccountingSemanticDigest(input);
      const existing = [...store.values()].find(
        (f) =>
          f.organizationId === scoped.organizationId && f.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        assertAccountingIdempotency(existing.semanticContentDigest, digest, input.idempotencyKey);
        return existing;
      }
      const frontier = { ...input, semanticContentDigest: digest };
      const key = `${scoped.organizationId}:${input.accountKey}:${input.runId}:${input.accountingSequence}`;
      store.set(key, frontier);
      return frontier;
    },
  };
}
