import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { Bar } from "@/lib/trader/intelligence/types";

import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import {
  persistBlindHoldoutSuccess,
  assertBlindHoldoutCandidateEligible,
  assertBlindHoldoutPayload,
  type BlindHoldoutRepository,
  type BlindHoldoutValidationResult,
  type RunBlindHoldoutValidationInput,
} from "@/lib/trader/research/blind-holdout-engine";
import { consumeDee540BlindTailAuthorization } from "@/lib/trader/research/dee-540-authorization-store";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { assertResearchRootPostgresDbV1 } from "@/lib/trader/research/research-root-postgres-db-v1";
import { BlindHoldoutValidationError } from "@/lib/trader/research/errors";
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

const parentHandleGuards = new WeakMap<object, {
  activeOutcomes: number;
  saved: Array<[string, unknown]>;
}>();

function armDee540ParentHandleGuard(ex: object): () => void {
  const target = ex as Record<string, unknown>;
  let guard = parentHandleGuards.get(ex);
  if (!guard) {
    guard = { activeOutcomes: 0, saved: [] };
    const forbid = () => {
      throw new Error(
        `${DEE540_BLIND_PARENT_HANDLE_FORBIDDEN}: blind-window query used the parent pool while the consume transaction is open`,
      );
    };
    for (const method of PARENT_HANDLE_METHODS) {
      const current = target[method];
      if (typeof current !== "function") continue;
      guard.saved.push([method, current]);
      target[method] = forbid;
    }
    parentHandleGuards.set(ex, guard);
  }
  guard.activeOutcomes += 1;
  let armed = true;
  return () => {
    if (!armed) return;
    armed = false;
    guard.activeOutcomes -= 1;
    // Several root outcome transactions can already be admitted by a pool
    // before their callbacks run. Keep the original methods until the last
    // outcome exits; never restore another outcome's temporary forbid wrapper.
    if (guard.activeOutcomes === 0) {
      for (const [method, original] of guard.saved) target[method] = original;
      parentHandleGuards.delete(ex);
    }
  };
}

/** Drizzle transaction client. Queries on this handle do not take a second pool connection. */
export type Dee540BlindTailExecutor = Parameters<Parameters<WaiaPostgresDb["transaction"]>[0]>[0];

declare const blindPayloadCapabilityBrand: unique symbol;
export type Dee540BlindPayloadCapability = Readonly<{ [blindPayloadCapabilityBrand]: true }>;
const activePayloadReads = new WeakMap<object, {
  executor: object;
  blindDigest: string;
  claimed: boolean;
}>();

/** The data loader claims this invocation's just-committed burn once. A token
 * found in the database from a past run never confers a fresh payload read. */
export function claimDee540BlindPayloadRead(
  executor: object,
  capability: Dee540BlindPayloadCapability,
  blindDigest: string,
): void {
  const active = activePayloadReads.get(capability);
  if (!active || active.executor !== executor || active.blindDigest !== blindDigest || active.claimed) {
    throw new BlindHoldoutValidationError("DEE540_ACTIVE_BLIND_PAYLOAD_CAPABILITY_REQUIRED");
  }
  active.claimed = true;
}

export type Dee540BlindTailBacktestInput = Parameters<
  RunBlindHoldoutValidationInput["runBacktest"]
>[0] & {
  executor: Dee540BlindTailExecutor;
};

export type CommitDee540BlindHoldoutInput = Omit<
  RunBlindHoldoutValidationInput,
  "repository" | "runBacktest" | "blindBars"
> & {
  blindDigest: string;
  /** Payload producer runs only after the durable consume, on its outcome client. */
  loadBlindBars?: (tx: Dee540BlindTailExecutor, capability: Dee540BlindPayloadCapability) => Promise<readonly Bar[]>;
  /** Already-owned in-memory fixtures; database-backed callers use loadBlindBars. */
  blindBars?: readonly Bar[];
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

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "blind holdout failed";
  return message.slice(0, 500);
}

export function dee540BlindTerminalRecord(input: {
  phase: "payload_read" | "backtest" | "result_insert";
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
  tx: Dee540BlindTailExecutor,
  run: (scope: Dee540BlindTailExecutor) => Promise<T>,
): Promise<T> {
  // Use the driver's nested transaction, including its scoped error state.
  // Raw SAVEPOINT / ROLLBACK TO SAVEPOINT SQL leaves Postgres.js's outer
  // uncaughtError set after a query fails, so it later rolls back a terminal row.
  return tx.transaction(run);
}

async function persistTerminal(
  input: CommitDee540BlindHoldoutInput,
  repository: BlindHoldoutRepository,
  phase: "payload_read" | "backtest" | "result_insert",
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
 * every query. Backtest effects and its success result share one savepoint;
 * result-insert failure rolls both back before recording the terminal error.
 * There is no path that clears the token.
 */
export async function commitDee540BlindHoldout(
  ex: Pick<WaiaPostgresDb, "transaction">,
  input: CommitDee540BlindHoldoutInput,
): Promise<BlindHoldoutValidationResult> {
  // Reject an outer transaction before status reads or bar disclosure: its
  // nested transaction is only a savepoint, so it cannot commit the burn.
  assertResearchRootPostgresDbV1(ex);
  if ((input.blindBars === undefined) === (input.loadBlindBars === undefined) ||
      (input.expectedBlindDigest !== undefined && input.expectedBlindDigest !== input.blindDigest)) {
    throw new BlindHoldoutValidationError("DEE540_BLIND_PAYLOAD_SOURCE_MISMATCH");
  }
  await assertBlindHoldoutCandidateEligible({
    context: input.context, candidate: input.candidate, repository: input.readRepository,
  });
  if (input.blindBars !== undefined) {
    assertBlindHoldoutPayload({ blindBars: input.blindBars, expectedBlindDigest: input.blindDigest });
  }

  await ex.transaction(async (tx) => {
    await consumeDee540BlindTailAuthorization(tx, { blindDigest: input.blindDigest });
  });

  let failure: unknown;
  let failed = false;
  const recorded = await ex.transaction(async (tx) => {
    const disarmParentGuard = armDee540ParentHandleGuard(ex);
    try {
      const repository = input.bindRepository(tx);
      let phase: "payload_read" | "backtest" | "result_insert" = "payload_read";
      const capability = Object.freeze({}) as Dee540BlindPayloadCapability;
      try {
        return await withOutcomeSavepoint(tx, async scope => {
          activePayloadReads.set(capability, { executor: scope, blindDigest: input.blindDigest, claimed: false });
          const payload = input.loadBlindBars ? await input.loadBlindBars(scope, capability) : input.blindBars!;
          assertBlindHoldoutPayload({ blindBars: payload, expectedBlindDigest: input.blindDigest });
          phase = "backtest";
          const metrics = await input.runBacktest({
            bars: payload,
            strategyId: input.candidate.strategyId,
            strategyVersion: input.candidate.strategyVersion,
            paramsJson: input.candidate.paramsJson,
            executor: scope,
          });
          phase = "result_insert";
          return persistBlindHoldoutSuccess({
            ...input,
            blindBars: payload,
            repository: input.bindRepository(scope),
            metrics,
          });
        });
      } catch (error) {
        failed = true;
        failure = error;
        return persistTerminal(input, repository, phase, error);
      } finally {
        activePayloadReads.delete(capability);
      }
    } finally {
      disarmParentGuard();
    }
  });
  if (failed) throw failure;
  return recorded;
}
