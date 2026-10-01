import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { sql } from "drizzle-orm";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  persistBlindHoldoutSuccess,
  assertBlindHoldoutNotYetRead,
  type BlindHoldoutRepository,
  type BlindHoldoutValidationResult,
  type RunBlindHoldoutValidationInput,
} from "@/lib/trader/research/blind-holdout-engine";
import { consumeDee540BlindTailAuthorization } from "@/lib/trader/research/dee-540-authorization-store";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
  type ResearchValidationMetrics,
} from "@/lib/trader/research/strategy-candidate.types";

export const DEE540_BLIND_TERMINAL_SCHEMA = "dee540_blind_terminal_v1" as const;

/**
 * Thrown when the blind window queries the parent pool while the consume
 * transaction holds its connection. A hang on `max: 1` cannot be broken by
 * `statement_timeout`, so the parent handle fails immediately instead.
 */
export const DEE540_BLIND_PARENT_HANDLE_FORBIDDEN = "DEE540_BLIND_PARENT_HANDLE_FORBIDDEN";

const PARENT_HANDLE_METHODS = [
  "select",
  "insert",
  "update",
  "delete",
  "execute",
  "transaction",
] as const;

function armDee540ParentHandleGuard(ex: object): () => void {
  const target = ex as Record<string, unknown>;
  const saved: Array<[string, unknown]> = [];
  const forbid = () => {
    throw new Error(
      `${DEE540_BLIND_PARENT_HANDLE_FORBIDDEN}: blind-window query used the parent pool while the consume transaction is open`,
    );
  };
  for (const method of PARENT_HANDLE_METHODS) {
    const current = target[method];
    if (typeof current !== "function") continue;
    saved.push([method, current]);
    target[method] = forbid;
  }
  return () => {
    for (const [method, original] of saved) target[method] = original;
  };
}

/** Drizzle transaction client. Queries on this handle do not take a second pool connection. */
export type Dee540BlindTailExecutor = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];

export type Dee540BlindTailBacktestInput = Parameters<
  RunBlindHoldoutValidationInput["runBacktest"]
>[0] & {
  executor: Dee540BlindTailExecutor;
};

export type CommitDee540BlindHoldoutInput = Omit<
  RunBlindHoldoutValidationInput,
  "repository" | "runBacktest"
> & {
  blindDigest: string;
  /** Reads used only before the strategy sees the bars. A throw here commits nothing. */
  readRepository: Pick<BlindHoldoutRepository, "getBlindValidationResultForCandidate">;
  /** Writes bound to the same transaction as the bar-content consume. */
  bindRepository: (tx: Dee540BlindTailExecutor) => BlindHoldoutRepository;
  /**
   * Runs on `executor` while the consume transaction holds the only pool connection.
   * Callers must not query the parent handle from this callback.
   */
  runBacktest: (input: Dee540BlindTailBacktestInput) => Promise<ResearchValidationMetrics>;
};

let savepointCounter = 0;

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "blind holdout failed";
  return message.slice(0, 500);
}

export function dee540BlindTerminalRecord(input: {
  phase: "backtest" | "result_insert";
  message: string;
  candidateId: string;
  datasetId: string;
}): { metricsJson: string; evidenceDigest: string } {
  const metricsJson = JSON.stringify({
    schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
    outcome: "error",
    phase: input.phase,
    message: input.message,
  });
  return {
    metricsJson,
    evidenceDigest: computeStableJsonDigest({
      schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
      candidateId: input.candidateId,
      datasetId: input.datasetId,
      phase: input.phase,
      metricsJson,
    }),
  };
}

async function withOutcomeSavepoint<T>(
  tx: Pick<Dee540BlindTailExecutor, "execute">,
  run: () => Promise<T>,
): Promise<T> {
  savepointCounter += 1;
  const name = `dee540_blind_outcome_${savepointCounter}`;
  await tx.execute(sql.raw(`SAVEPOINT ${name}`));
  try {
    const value = await run();
    await tx.execute(sql.raw(`RELEASE SAVEPOINT ${name}`));
    return value;
  } catch (error) {
    await tx.execute(sql.raw(`ROLLBACK TO SAVEPOINT ${name}`));
    throw error;
  }
}

async function persistTerminal(
  input: CommitDee540BlindHoldoutInput,
  repository: BlindHoldoutRepository,
  phase: "backtest" | "result_insert",
  error: unknown,
): Promise<BlindHoldoutValidationResult> {
  const validatedAt = input.validatedAt ?? new Date();
  const terminal = dee540BlindTerminalRecord({
    phase,
    message: errorMessage(error),
    candidateId: input.candidate.id,
    datasetId: input.datasetId,
  });
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const result = await repository.insertBlindValidationResult(input.context, {
    id: newId(),
    candidateId: input.candidate.id,
    datasetId: input.datasetId,
    metricsJson: terminal.metricsJson,
    evidenceDigest: terminal.evidenceDigest,
    validatedAt,
  });
  const metrics: ResearchValidationMetrics = {
    schemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
    tradeCount: 0,
    periodRealizedPnl: "0",
    periodTotalFees: "0",
    byRegime: [],
  };
  return { result, metrics };
}

/**
 * Burns the DEE-540 bar-content token before the strategy sees the bars.
 * The primary key on `trader_dee540_bar_consumption` is the concurrency gate:
 * the burn commits in its own transaction, so a second opener blocks on that
 * key and then fails. A later outcome rollback cannot put the permission back.
 * Checks that run before the burn throw with nothing written.
 * After the bars are shown, a backtest or result-insert failure still records
 * a terminal error row when that insert commits. If the terminal insert itself
 * throws, the burn stays committed and no second opener can run the backtest.
 * The backtest receives the outcome transaction client and must use it for
 * every query. There is no path that clears the token.
 */
export async function commitDee540BlindHoldout(
  ex: Pick<WaiaPostgresDb, "transaction">,
  input: CommitDee540BlindHoldoutInput,
): Promise<BlindHoldoutValidationResult> {
  // Reject an outer transaction before status reads or bar disclosure: its
  // nested transaction is only a savepoint, so it cannot commit the burn.
  assertResearchRootPostgresDbV1(ex);
  await assertBlindHoldoutNotYetRead({
    context: input.context,
    candidate: input.candidate,
    blindBars: input.blindBars,
    expectedBlindDigest: input.expectedBlindDigest,
    repository: input.readRepository,
  });

  await ex.transaction(async (tx) => {
    await consumeDee540BlindTailAuthorization(tx, { blindDigest: input.blindDigest });
  });

  let failure: unknown = null;
  const recorded = await ex.transaction(async (tx) => {
    const disarmParentGuard = armDee540ParentHandleGuard(ex);
    try {
      const repository = input.bindRepository(tx);
      let metrics: ResearchValidationMetrics;
      try {
        metrics = await input.runBacktest({
          bars: input.blindBars,
          strategyId: input.candidate.strategyId,
          strategyVersion: input.candidate.strategyVersion,
          paramsJson: input.candidate.paramsJson,
          executor: tx,
        });
      } catch (error) {
        failure = error;
        return persistTerminal(input, repository, "backtest", error);
      }
      try {
        return await withOutcomeSavepoint(tx, () =>
          persistBlindHoldoutSuccess({
            ...input,
            repository,
            metrics,
          }),
        );
      } catch (error) {
        failure = error;
        return persistTerminal(input, repository, "result_insert", error);
      }
    } finally {
      disarmParentGuard();
    }
  });
  if (failure) throw failure;
  return recorded;
}
