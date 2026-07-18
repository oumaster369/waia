import { createHash } from "node:crypto";

import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, desc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { AccountDrawdownState } from "@/lib/trader/risk/drawdown-policy.types";
import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import { normalizeAccountingStateDrawdownFields } from "@/lib/trader/accounting/accounting-frontier.types";
import type { HtrGuardianBreachState } from "@/lib/trader/guardian/htr-guardian-exit-taxonomy";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import type {
  HtrDrawdownPersistencePort,
  HtrDrawdownResumeMode,
} from "@/lib/trader/accounting/htr-accounting-cycle-bridge";
import {
  appendStrategyDrawdownCheckpoint,
  createStrategyDrawdownRepositoryPostgres,
} from "@/lib/trader/risk/strategy-drawdown-repository-postgres";
import {
  orgScopedWhere,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgReadExecutor = Pick<WaiaPostgresDb, "select">;
type PgWriteExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

function mapRow(
  row: typeof pgSchema.traderAccountDrawdownCheckpoint.$inferSelect,
): AccountDrawdownState {
  return {
    organizationId: row.organizationId,
    accountKey: row.accountKey,
    portfolioId: row.portfolioId,
    runId: row.runId,
    seq: row.seq,
    asOf: row.asOf.toISOString(),
    monthKey: row.monthKey,
    equityUsdt: row.equityUsdt,
    accountPeakHwm: row.accountPeakHwm,
    monthlyPeakHwm: row.monthlyPeakHwm,
    accountDrawdownBps: row.accountDrawdownBps,
    monthlyDrawdownBps: row.monthlyDrawdownBps,
    breachState: row.breachState as AccountDrawdownState["breachState"],
  };
}

export type AppendAccountDrawdownCheckpointInput = Omit<AccountDrawdownState, "organizationId"> & {
  id: string;
  contentDigest?: string;
};

function buildContentDigest(state: AccountDrawdownState & { id: string }): string {
  return createHash("sha256")
    .update(
      canonicalJsonString({
        id: state.id,
        organizationId: state.organizationId,
        accountKey: state.accountKey,
        portfolioId: state.portfolioId,
        runId: state.runId,
        seq: state.seq,
        asOf: state.asOf,
        monthKey: state.monthKey,
        equityUsdt: state.equityUsdt,
        accountPeakHwm: state.accountPeakHwm,
        monthlyPeakHwm: state.monthlyPeakHwm,
        accountDrawdownBps: state.accountDrawdownBps,
        monthlyDrawdownBps: state.monthlyDrawdownBps,
        breachState: state.breachState,
      }),
      "utf8",
    )
    .digest("hex");
}

export type AccountDrawdownRepository = {
  loadLatest(
    context: OrgContext,
    key: { accountKey: string; portfolioId: string; runId: string },
  ): Promise<AccountDrawdownState | null>;
  append(
    context: OrgContext,
    input: AppendAccountDrawdownCheckpointInput,
  ): Promise<AccountDrawdownState>;
};

export async function loadAccountDrawdownCheckpoint(
  repository: AccountDrawdownRepository,
  context: OrgContext,
  key: { accountKey: string; portfolioId: string; runId: string },
): Promise<AccountDrawdownState | null> {
  return repository.loadLatest(context, key);
}

export async function appendAccountDrawdownCheckpoint(
  repository: AccountDrawdownRepository,
  context: OrgContext,
  input: AppendAccountDrawdownCheckpointInput,
): Promise<AccountDrawdownState> {
  return repository.append(context, input);
}

export function createAccountDrawdownRepositoryPostgres(
  ex: PgReadExecutor & PgWriteExecutor,
): AccountDrawdownRepository {
  return {
    async loadLatest(context, key) {
      const scoped = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.traderAccountDrawdownCheckpoint)
        .where(
          and(
            orgScopedWhere(pgSchema.traderAccountDrawdownCheckpoint.organizationId, scoped),
            eq(pgSchema.traderAccountDrawdownCheckpoint.accountKey, key.accountKey),
            eq(pgSchema.traderAccountDrawdownCheckpoint.portfolioId, key.portfolioId),
            eq(pgSchema.traderAccountDrawdownCheckpoint.runId, key.runId),
          ),
        )
        .orderBy(desc(pgSchema.traderAccountDrawdownCheckpoint.seq))
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async append(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      const state: AccountDrawdownState & { id: string } = {
        id: input.id,
        organizationId: scoped.organizationId,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        runId: input.runId,
        seq: input.seq,
        asOf: input.asOf,
        monthKey: input.monthKey,
        equityUsdt: input.equityUsdt,
        accountPeakHwm: input.accountPeakHwm,
        monthlyPeakHwm: input.monthlyPeakHwm,
        accountDrawdownBps: input.accountDrawdownBps,
        monthlyDrawdownBps: input.monthlyDrawdownBps,
        breachState: input.breachState,
      };
      const contentDigest = input.contentDigest ?? buildContentDigest(state);

      await ex.insert(pgSchema.traderAccountDrawdownCheckpoint).values({
        id: input.id,
        organizationId: scoped.organizationId,
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        runId: input.runId,
        seq: input.seq,
        asOf: new Date(input.asOf),
        monthKey: input.monthKey,
        equityUsdt: input.equityUsdt,
        accountPeakHwm: input.accountPeakHwm,
        monthlyPeakHwm: input.monthlyPeakHwm,
        accountDrawdownBps: input.accountDrawdownBps,
        monthlyDrawdownBps: input.monthlyDrawdownBps,
        breachState: input.breachState,
        contentDigest,
      });

      const rows = await ex
        .select()
        .from(pgSchema.traderAccountDrawdownCheckpoint)
        .where(
          and(
            eq(pgSchema.traderAccountDrawdownCheckpoint.id, input.id),
            orgScopedWhere(pgSchema.traderAccountDrawdownCheckpoint.organizationId, scoped),
          ),
        )
        .limit(1);

      if (!rows[0]) {
        throw new Error("[wp16] account drawdown checkpoint insert failed");
      }
      return mapRow(rows[0]);
    },
  };
}

export function buildAccountDrawdownCheckpointFromBridgeState(input: {
  state: AccountingStateV1;
  portfolioId: string;
  seq: number;
  id: string;
  breachState: HtrGuardianBreachState;
}): AppendAccountDrawdownCheckpointInput {
  const drawdownState = normalizeAccountingStateDrawdownFields(input.state);
  return {
    id: input.id,
    accountKey: drawdownState.accountKey,
    portfolioId: input.portfolioId,
    runId: drawdownState.runId,
    seq: input.seq,
    asOf: drawdownState.frontierAsOf,
    monthKey: drawdownState.monthKey,
    equityUsdt: drawdownState.equity,
    accountPeakHwm: drawdownState.equityHwm,
    monthlyPeakHwm: drawdownState.monthlyPeakHwm,
    accountDrawdownBps: drawdownState.accountDrawdownBps,
    monthlyDrawdownBps: drawdownState.monthlyDrawdownBps,
    breachState: input.breachState,
  };
}

export function createHtrDrawdownPersistencePortPostgres(input: {
  db: PgReadExecutor & PgWriteExecutor & Partial<Pick<WaiaPostgresDb, "transaction">>;
  context: OrgContext;
  portfolioId: string;
  accountKey: string;
  runId: string;
  resumeMode: HtrDrawdownResumeMode;
  newCheckpointId: HtrDrawdownPersistencePort["newCheckpointId"];
}): HtrDrawdownPersistencePort {
  const accountRepo = createAccountDrawdownRepositoryPostgres(input.db);
  const strategyRepo = createStrategyDrawdownRepositoryPostgres(input.db);
  return {
    portfolioId: input.portfolioId,
    resumeMode: input.resumeMode,
    organizationId: input.context.organizationId,
    accountKey: input.accountKey,
    runId: input.runId,
    loadAccountCheckpoint: () =>
      accountRepo.loadLatest(input.context, {
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        runId: input.runId,
      }),
    loadStrategyCheckpoint: (strategyId, strategyVersion) =>
      strategyRepo.loadLatest(input.context, {
        accountKey: input.accountKey,
        portfolioId: input.portfolioId,
        runId: input.runId,
        strategyId,
        strategyVersion,
      }),
    appendAccountCheckpoint: async (row) => {
      await appendAccountDrawdownCheckpoint(accountRepo, input.context, row);
    },
    appendStrategyCheckpoint: async (row) => {
      await appendStrategyDrawdownCheckpoint(strategyRepo, input.context, row);
    },
    newCheckpointId: input.newCheckpointId,
    runInTransaction: async (fn) => {
      if (typeof input.db.transaction === "function") {
        return input.db.transaction(async () => fn());
      }
      return fn();
    },
  };
}
