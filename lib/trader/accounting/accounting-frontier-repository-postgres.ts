import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq, sql } from "drizzle-orm";

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
      monthKey: row.monthKey,
      cash: row.cash,
      positionQuantityJson: row.positionQuantityJson as Record<string, string>,
      grossPositionBasisJson: row.grossPositionBasisJson as Record<string, string>,
      netPositionBasisJson: row.netPositionBasisJson as Record<string, string>,
      grossRealizedPnl: row.grossRealizedPnl,
      netRealizedPnl: row.netRealizedPnl,
      marksJson: row.marksJson as AccountingFrontierV1["marks"],
      markedPositionValue: row.markedPositionValue,
      equity: row.equity,
      equityHwm: row.equityHwm,
      monthlyPeakHwm: row.monthlyPeakHwm,
      monthlyDrawdownBps: row.monthlyDrawdownBps,
      strategyPeakHwmByKeyJson: row.strategyPeakHwmByKeyJson as Record<string, string> | null,
      strategyDrawdownBpsByKeyJson:
        row.strategyDrawdownBpsByKeyJson as Record<string, number> | null,
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
      const incompleteSemanticState = [
        ["monthKey", row.monthKey],
        ["markedPositionValue", row.markedPositionValue],
        ["monthlyPeakHwm", row.monthlyPeakHwm],
        ["monthlyDrawdownBps", row.monthlyDrawdownBps],
        ["strategyPeakHwmByKeyJson", row.strategyPeakHwmByKeyJson],
        ["strategyDrawdownBpsByKeyJson", row.strategyDrawdownBpsByKeyJson],
      ].filter(([, value]) => value == null).map(([name]) => name);
      if (incompleteSemanticState.length > 0) {
        throw new Error(
          `[accounting] incomplete durable semantic state: ${incompleteSemanticState.join(",")}`,
        );
      }
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(row.monthKey)) ||
          typeof row.markedPositionValue !== "string" ||
          typeof row.monthlyPeakHwm !== "string" ||
          !Number.isInteger(row.monthlyDrawdownBps) || row.monthlyDrawdownBps! < 0 ||
          typeof row.strategyPeakHwmByKeyJson !== "object" ||
          Array.isArray(row.strategyPeakHwmByKeyJson) ||
          typeof row.strategyDrawdownBpsByKeyJson !== "object" ||
          Array.isArray(row.strategyDrawdownBpsByKeyJson)) {
        throw new Error(
          `[accounting] invalid durable semantic state: month=${String(row.monthKey)};` +
          `marked=${typeof row.markedPositionValue};monthlyPeak=${typeof row.monthlyPeakHwm};` +
          `monthlyDrawdown=${String(row.monthlyDrawdownBps)};` +
          `strategyPeak=${Array.isArray(row.strategyPeakHwmByKeyJson) ? "array" : typeof row.strategyPeakHwmByKeyJson};` +
          `strategyDrawdown=${Array.isArray(row.strategyDrawdownBpsByKeyJson) ? "array" : typeof row.strategyDrawdownBpsByKeyJson}`,
        );
      }

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

      try {
        await ex.insert(pgSchema.traderAccountingFrontier).values({
        id: row.id,
        organizationId: scoped.organizationId,
        accountKey: row.accountKey,
        runId: row.runId,
        accountingSequence: BigInt(row.accountingSequence),
        frontierAsOf: new Date(row.frontierAsOf),
        monthKey: row.monthKey,
        cash: row.cash,
        positionQuantityJson:
          sql`${JSON.stringify(row.positionQuantityJson)}::text::jsonb`,
        grossPositionBasisJson:
          sql`${JSON.stringify(row.grossPositionBasisJson)}::text::jsonb`,
        netPositionBasisJson:
          sql`${JSON.stringify(row.netPositionBasisJson)}::text::jsonb`,
        grossRealizedPnl: row.grossRealizedPnl,
        netRealizedPnl: row.netRealizedPnl,
        marksJson: sql`${JSON.stringify(row.marksJson)}::text::jsonb`,
        markedPositionValue: row.markedPositionValue,
        equity: row.equity,
        equityHwm: row.equityHwm,
        monthlyPeakHwm: row.monthlyPeakHwm,
        monthlyDrawdownBps: row.monthlyDrawdownBps,
        strategyPeakHwmByKeyJson:
          sql`${JSON.stringify(row.strategyPeakHwmByKeyJson)}::text::jsonb`,
        strategyDrawdownBpsByKeyJson:
          sql`${JSON.stringify(row.strategyDrawdownBpsByKeyJson)}::text::jsonb`,
        accountDrawdownBps: row.accountDrawdownBps,
        sourceFillId: row.sourceFillId,
        sourceEconomicsDigest: row.sourceEconomicsDigest,
        semanticContentDigest: digest,
        idempotencyKey: row.idempotencyKey,
          schemaVersion: row.schemaVersion,
        });
      } catch (error) {
        if ((error as { constraint_name?: string }).constraint_name ===
            "trader_accounting_frontier_semantic_state_complete") {
          throw new Error(
            `[accounting] PostgreSQL rejected durable semantic state: ` +
            `month=${String(row.monthKey)};marked=${String(row.markedPositionValue)};` +
            `monthlyPeak=${String(row.monthlyPeakHwm)};` +
            `monthlyDrawdown=${String(row.monthlyDrawdownBps)};` +
            `strategyPeak=${JSON.stringify(row.strategyPeakHwmByKeyJson)};` +
            `strategyDrawdown=${JSON.stringify(row.strategyDrawdownBpsByKeyJson)}`,
            { cause: error },
          );
        }
        throw error;
      }

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
