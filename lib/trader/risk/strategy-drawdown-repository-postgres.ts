import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { StrategyDrawdownState } from "@/lib/trader/risk/drawdown-policy.types";
import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrGuardianBreachState } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { formatDecimal, parseDecimal, subtractDecimal } from "@/lib/trader/risk/numeric";
import { resolveVirtualAllocation } from "@/lib/trader/risk/strategy-attribution";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(
  row: typeof pgSchema.traderStrategyDrawdownCheckpoint.$inferSelect,
): StrategyDrawdownState & { strategyAllocationUsdt: string } {
  return {
    organizationId: row.organizationId,
    accountKey: row.accountKey,
    portfolioId: row.portfolioId,
    runId: row.runId,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    seq: row.seq,
    asOf: row.asOf.toISOString(),
    monthKey: "",
    strategyEquityUsdt: row.strategyEquityUsdt,
    strategyPeakHwm: row.strategyPeakHwm,
    strategyDrawdownBps: row.strategyDrawdownBps,
    breachState: row.breachState as StrategyDrawdownState["breachState"],
    strategyAllocationUsdt: row.strategyAllocationUsdt,
  };
}

export type AppendStrategyDrawdownCheckpointInput = {
  id: string;
  accountKey: string;
  portfolioId: string;
  runId: string;
  strategyId: string;
  strategyVersion: string;
  seq: number;
  asOf: string;
  strategyAllocationUsdt: string;
  strategyEquityUsdt: string;
  strategyPeakHwm: string;
  strategyDrawdownBps: number;
  breachState: StrategyDrawdownState["breachState"];
  contentDigest?: string;
};

function buildContentDigest(
  input: AppendStrategyDrawdownCheckpointInput & { organizationId: string },
): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        id: input.id,
        organizationId: input.organizationId,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        runId: input.runId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        seq: input.seq,
        asOf: input.asOf,
        strategyAllocationUsdt: input.strategyAllocationUsdt,
        strategyEquityUsdt: input.strategyEquityUsdt,
        strategyPeakHwm: input.strategyPeakHwm,
        strategyDrawdownBps: input.strategyDrawdownBps,
        breachState: input.breachState,
      }),
      "utf8",
    )
    .digest("hex");
}

export type StrategyDrawdownRepository = {
  loadLatest(
    context: OrgContext,
    key: {
      accountKey: string;
      portfolioId: string;
      runId: string;
      strategyId: string;
      strategyVersion: string;
    },
  ): Promise<(StrategyDrawdownState & { strategyAllocationUsdt: string }) | null>;
  append(
    context: OrgContext,
    input: AppendStrategyDrawdownCheckpointInput,
  ): Promise<StrategyDrawdownState & { strategyAllocationUsdt: string }>;
};

export async function loadStrategyDrawdownCheckpoint(
  repository: StrategyDrawdownRepository,
  context: OrgContext,
  key: {
    accountKey: string;
    portfolioId: string;
    runId: string;
    strategyId: string;
    strategyVersion: string;
  },
): Promise<(StrategyDrawdownState & { strategyAllocationUsdt: string }) | null> {
  return repository.loadLatest(context, key);
}

export async function appendStrategyDrawdownCheckpoint(
  repository: StrategyDrawdownRepository,
  context: OrgContext,
  input: AppendStrategyDrawdownCheckpointInput,
): Promise<StrategyDrawdownState & { strategyAllocationUsdt: string }> {
  return repository.append(context, input);
}

export function createStrategyDrawdownRepositoryPostgres(
  ex: PgReadExecutor & PgWriteExecutor,
): StrategyDrawdownRepository {
  return {
    async loadLatest(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyDrawdownCheckpoint)
        .where(
          and(
            orgScopedWhere(pgSchema.traderStrategyDrawdownCheckpoint.organizationId, scoped),
            eq(pgSchema.traderStrategyDrawdownCheckpoint.accountKey, key.accountKey),
            eq(pgSchema.traderStrategyDrawdownCheckpoint.portfolioId, key.portfolioId),
            eq(pgSchema.traderStrategyDrawdownCheckpoint.runId, key.runId),
            eq(pgSchema.traderStrategyDrawdownCheckpoint.strategyId, key.strategyId),
            eq(pgSchema.traderStrategyDrawdownCheckpoint.strategyVersion, key.strategyVersion),
          ),
        )
        .orderBy(desc(pgSchema.traderStrategyDrawdownCheckpoint.seq))
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async append(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const contentDigest =
        input.contentDigest ??
        buildContentDigest({ ...input, organizationId: scoped.organizationId });

      await ex.insert(pgSchema.traderStrategyDrawdownCheckpoint).values({
        id: input.id,
        organizationId: scoped.organizationId,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        runId: input.runId,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        seq: input.seq,
        asOf: new Date(input.asOf),
        strategyAllocationUsdt: input.strategyAllocationUsdt,
        strategyEquityUsdt: input.strategyEquityUsdt,
        strategyPeakHwm: input.strategyPeakHwm,
        strategyDrawdownBps: input.strategyDrawdownBps,
        breachState: input.breachState,
        contentDigest,
      });

      const rows = await ex
        .select()
        .from(pgSchema.traderStrategyDrawdownCheckpoint)
        .where(
          and(
            eq(pgSchema.traderStrategyDrawdownCheckpoint.id, input.id),
            orgScopedWhere(pgSchema.traderStrategyDrawdownCheckpoint.organizationId, scoped),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        throw new Error("[wp16] strategy drawdown checkpoint insert failed");
      }
      return mapRow(rows[0]);
    },
  };
}

export function buildStrategyDrawdownCheckpointsFromBridgeState(input: {
  state: AccountingStateV1;
  portfolioId: string;
  seqByKey: Record<string, number>;
  idFactory: (attrKey: string) => string;
  breachState: HtrGuardianBreachState;
}): AppendStrategyDrawdownCheckpointInput[] {
  const checkpoints: AppendStrategyDrawdownCheckpointInput[] = [];
  for (const [attrKey, peak] of Object.entries(input.state.strategyPeakHwmByKey)) {
    const [strategyId, strategyVersion] = attrKey.split(":");
    if (!strategyId || !strategyVersion) {
      continue;
    }
    const allocation = resolveVirtualAllocation(strategyId, strategyVersion);
    const drawdownBps = input.state.strategyDrawdownBpsByKey[attrKey] ?? 0;
    const peakScaled = parseDecimal(peak);
    const drawdownScaled = drawdownBps > 0 ? (peakScaled * BigInt(drawdownBps)) / 10000n : 0n;
    const strategyEquityUsdt = drawdownBps > 0 ? formatDecimal(peakScaled - drawdownScaled) : peak;
    checkpoints.push({
      id: input.idFactory(attrKey),
      accountKey: input.state.accountKey,
      portfolioId: input.portfolioId,
      runId: input.state.runId,
      strategyId,
      strategyVersion,
      seq: input.seqByKey[attrKey] ?? 1,
      asOf: input.state.frontierAsOf,
      strategyAllocationUsdt: allocation,
      strategyEquityUsdt,
      strategyPeakHwm: peak,
      strategyDrawdownBps: drawdownBps,
      breachState: input.breachState,
    });
  }
  return checkpoints;
}
