import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import { computeBarSetDigest } from "@/lib/trader/market-data/research-dataset";
import {
  commitDee540BlindHoldout,
  DEE540_BLIND_TERMINAL_SCHEMA,
} from "@/lib/trader/research/dee-540-blind-tail-commit";
import { BlindHoldoutValidationError } from "@/lib/trader/research/errors";
import type {
  ResearchValidationMetrics,
  StrategyCandidate,
} from "@/lib/trader/research/strategy-candidate.types";

// This file exercises commit ordering with an in-memory transaction fake. The
// native PostgreSQL integration test covers the real root-database identity
// boundary; keep this fake from claiming that capability.
vi.mock("@/lib/trader/research/research-root-postgres-db-v1", () => ({
  assertResearchRootPostgresDbV1: () => undefined,
}));

const ORG_ID = "00000000-0000-4000-8000-00000000d001";
const CANDIDATE_ID = "00000000-0000-4000-8000-00000000d002";
const DATASET_ID = "00000000-0000-4000-8000-00000000d003";

function buildBars(count: number, close = "100"): Bar[] {
  return Array.from({ length: count }, (_, index) => ({
    symbol: "BTC/USDT",
    interval: "1m" as const,
    open: close,
    high: close,
    low: close,
    close,
    volume: "1",
    barOpenTime: new Date(Date.parse("2026-06-22T09:40:00.000Z") + index * 60_000).toISOString(),
    barCloseTime: new Date(Date.parse("2026-06-22T09:41:00.000Z") + index * 60_000).toISOString(),
  }));
}

function buildMetrics(): ResearchValidationMetrics {
  return {
    schemaVersion: "1.0.0",
    tradeCount: 1,
    periodRealizedPnl: "1.0",
    periodTotalFees: "0.1",
    byRegime: [],
  };
}

function buildCandidate(overrides: Partial<StrategyCandidate> = {}): StrategyCandidate {
  return {
    id: CANDIDATE_ID,
    organizationId: ORG_ID,
    strategyId: "mean_reversion_v0",
    strategyVersion: "0.1.0",
    hypothesisId: null,
    trialId: null,
    status: "walk_forward_validated",
    paramsJson: "{}",
    blindUsed: false,
    createdAt: new Date("2026-06-22T00:00:00.000Z"),
    updatedAt: new Date("2026-06-22T00:00:00.000Z"),
    ...overrides,
  };
}

type LogEntry =
  | { kind: "savepoint"; name: string }
  | { kind: "consume"; blindDigest: string }
  | { kind: "result"; metricsJson: string }
  | { kind: "mark" }
  | { kind: "status"; status: string };

function sqlText(query: { queryChunks?: Array<{ value?: string[] }> }): string {
  const value = query.queryChunks?.[0]?.value;
  return Array.isArray(value) ? value.join("") : "";
}

/**
 * In-memory transaction: a statement error aborts the transaction until
 * ROLLBACK TO SAVEPOINT. Returning from the callback commits; throwing discards.
 */
function createHarness(options?: {
  failFirstResultInsert?: boolean;
  failAllResultInserts?: boolean;
}) {
  const committed: LogEntry[] = [];
  const committedTokens = new Set<string>();
  const holders = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  let transactionCalls = 0;
  const states = new WeakMap<object, { log: LogEntry[]; aborted: boolean; token: string | null }>();

  function uniqueViolation(): Error {
    return Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
    });
  }

  function wake(token: string): void {
    const pending = waiters.get(token) ?? [];
    waiters.delete(token);
    for (const resolve of pending) resolve();
  }

  async function acquire(token: string): Promise<void> {
    while (true) {
      if (committedTokens.has(token)) throw uniqueViolation();
      if (!holders.has(token)) {
        holders.add(token);
        return;
      }
      await new Promise<void>((resolve) => {
        const pending = waiters.get(token) ?? [];
        pending.push(resolve);
        waiters.set(token, pending);
      });
    }
  }

  function commitToken(token: string): void {
    holders.delete(token);
    committedTokens.add(token);
    wake(token);
  }

  function releaseToken(token: string): void {
    holders.delete(token);
    wake(token);
  }

  const ex = {
    transaction: async <T>(fn: (tx: object) => Promise<T>): Promise<T> => {
      transactionCalls += 1;
      const state = { log: [] as LogEntry[], aborted: false, token: null as string | null };
      const tx = {
        insert: () => ({
          values: async (row: { blindDigest: string; barContentToken?: string }) => {
            if (state.aborted) throw new Error("current transaction is aborted");
            if (row.barContentToken) {
              await acquire(row.barContentToken);
              state.token = row.barContentToken;
            }
            state.log.push({ kind: "consume", blindDigest: row.blindDigest });
          },
        }),
        execute: async (query: { queryChunks?: Array<{ value?: string[] }> }) => {
          const text = sqlText(query).trim();
          if (text.startsWith("ROLLBACK TO SAVEPOINT ")) {
            const name = text.slice("ROLLBACK TO SAVEPOINT ".length).trim();
            const index = state.log.findLastIndex(
              (entry) => entry.kind === "savepoint" && entry.name === name,
            );
            if (index < 0) throw new Error(`savepoint ${name} does not exist`);
            state.log.splice(index);
            state.aborted = false;
            return;
          }
          if (state.aborted) throw new Error("current transaction is aborted");
          if (text.startsWith("SAVEPOINT ")) {
            state.log.push({
              kind: "savepoint",
              name: text.slice("SAVEPOINT ".length).trim(),
            });
            return;
          }
          if (text.startsWith("RELEASE SAVEPOINT ")) {
            const name = text.slice("RELEASE SAVEPOINT ".length).trim();
            const index = state.log.findLastIndex(
              (entry) => entry.kind === "savepoint" && entry.name === name,
            );
            if (index < 0) throw new Error(`savepoint ${name} does not exist`);
            state.log.splice(index, 1);
            return;
          }
          throw new Error(`unexpected sql: ${text}`);
        },
      };
      states.set(tx, state);
      try {
        const value = await fn(tx);
        if (state.aborted) throw new Error("current transaction is aborted");
        if (state.token) commitToken(state.token);
        state.token = null;
        committed.push(...state.log);
        return value;
      } catch (error) {
        if (state.token) releaseToken(state.token);
        state.token = null;
        throw error;
      }
    },
  };

  let resultInserts = 0;
  const bindRepository = (tx: object) => {
    const state = states.get(tx);
    if (!state) throw new Error("repository used outside the consume transaction");
    return {
      getBlindValidationResultForCandidate: vi.fn().mockResolvedValue(null),
      insertBlindValidationResult: vi.fn(
        async (_context: unknown, row: { metricsJson: string }) => {
          if (state.aborted) throw new Error("current transaction is aborted");
          if (options?.failAllResultInserts) {
            throw new Error("terminal insert failed");
          }
          resultInserts += 1;
          state.log.push({ kind: "result", metricsJson: row.metricsJson });
          if (options?.failFirstResultInsert && resultInserts === 1) {
            state.aborted = true;
            throw new Error("result insert failure");
          }
          return {
            id: "00000000-0000-4000-8000-00000000d010",
            organizationId: ORG_ID,
            candidateId: CANDIDATE_ID,
            datasetId: DATASET_ID,
            metricsJson: row.metricsJson,
            evidenceDigest: "digest",
            validatedAt: new Date("2026-06-22T12:00:00.000Z"),
            createdAt: new Date("2026-06-22T12:00:00.000Z"),
          };
        },
      ),
      markStrategyCandidateBlindUsed: vi.fn(async () => {
        if (state.aborted) throw new Error("current transaction is aborted");
        state.log.push({ kind: "mark" });
        return buildCandidate({ blindUsed: true });
      }),
      updateStrategyCandidateStatus: vi.fn(
        async (_context: unknown, _id: string, status: string) => {
          if (state.aborted) throw new Error("current transaction is aborted");
          state.log.push({ kind: "status", status });
          return buildCandidate({ status: status as StrategyCandidate["status"] });
        },
      ),
    };
  };

  return {
    ex,
    bindRepository,
    get transactionCalls() {
      return transactionCalls;
    },
    committed: () => committed.filter((entry) => entry.kind !== "savepoint"),
  };
}

function baseInput(
  harness: ReturnType<typeof createHarness>,
  overrides: {
    bars?: readonly Bar[];
    status?: StrategyCandidate["status"];
    expectedBlindDigest?: string;
    getResult?: () => Promise<null>;
    runBacktest?: (input: { bars: readonly Bar[] }) => Promise<ResearchValidationMetrics>;
  } = {},
) {
  const bars = overrides.bars ?? buildBars(4);
  const digest = computeBarSetDigest(bars);
  return {
    blindDigest: digest,
    context: { organizationId: ORG_ID },
    candidate: buildCandidate({ status: overrides.status ?? "walk_forward_validated" }),
    datasetId: DATASET_ID,
    blindBars: bars,
    expectedBlindDigest: overrides.expectedBlindDigest ?? digest,
    runBacktest:
      overrides.runBacktest ??
      (async () => {
        throw new Error("runBacktest should not have been called");
      }),
    readRepository: {
      getBlindValidationResultForCandidate: overrides.getResult ?? (async () => null),
    },
    bindRepository: harness.bindRepository,
    newId: () => "00000000-0000-4000-8000-00000000d011",
  };
}

function committedResults(harness: ReturnType<typeof createHarness>) {
  return harness.committed().filter((entry) => entry.kind === "result");
}

function committedConsumes(harness: ReturnType<typeof createHarness>) {
  return harness.committed().filter((entry) => entry.kind === "consume");
}

describe("DEE-540 blind consume commits with the validation outcome", () => {
  it("does not reopen a consumed holdout through an env path or replay flag", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trader/research/dee-540-blind-tail-commit.ts"),
      "utf8",
    );
    expect(source).not.toContain("WAIA_DEE540_CONSUMPTION_PATH");
    expect(source).not.toContain("replay");
    expect(source).toContain("SAVEPOINT ");
    expect(source).toContain("ROLLBACK TO SAVEPOINT ");
    expect(source).toContain("executor: tx");
    expect(source).toContain("DEE540_BLIND_PARENT_HANDLE_FORBIDDEN");
    expect(source).not.toContain("That remaining edge is left for Linear.");
    const transactions = source.split("ex.transaction");
    expect(transactions).toHaveLength(3);
    expect(transactions[1]).toContain("consumeDee540BlindTailAuthorization(");
    expect(transactions[1]).not.toContain("runBacktest(");
    expect(transactions[2]).toContain("runBacktest(");
    expect(transactions[2]).not.toContain("consumeDee540BlindTailAuthorization(");
  });

  it("throws immediately when the blind backtest queries the parent handle", async () => {
    const harness = createHarness();
    const parent = harness.ex as { select?: () => Promise<void> };
    parent.select = async () => undefined;
    await expect(
      commitDee540BlindHoldout(
        harness.ex as never,
        baseInput(harness, {
          runBacktest: async () => {
            await parent.select?.();
            return buildMetrics();
          },
        }),
      ),
    ).rejects.toThrow("DEE540_BLIND_PARENT_HANDLE_FORBIDDEN");
    expect(committedConsumes(harness)).toHaveLength(1);
    expect(committedResults(harness)).toHaveLength(1);
    expect(
      JSON.parse((committedResults(harness)[0] as { metricsJson: string }).metricsJson),
    ).toMatchObject({
      schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
      outcome: "error",
      phase: "backtest",
    });
  });

  it("commits nothing when the status read fails before the bars are shown", async () => {
    const harness = createHarness();
    const runBacktest = vi.fn();
    await expect(
      commitDee540BlindHoldout(
        harness.ex as never,
        baseInput(harness, {
          getResult: async () => {
            throw new Error("status read failure");
          },
          runBacktest,
        }),
      ),
    ).rejects.toThrow("status read failure");
    expect(harness.transactionCalls).toBe(0);
    expect(harness.committed()).toEqual([]);
    expect(runBacktest).not.toHaveBeenCalled();
  });

  it("commits nothing when the candidate is not walk_forward_validated", async () => {
    const harness = createHarness();
    const runBacktest = vi.fn();
    await expect(
      commitDee540BlindHoldout(
        harness.ex as never,
        baseInput(harness, { status: "backtested", runBacktest }),
      ),
    ).rejects.toBeInstanceOf(BlindHoldoutValidationError);
    expect(harness.transactionCalls).toBe(0);
    expect(harness.committed()).toEqual([]);
    expect(runBacktest).not.toHaveBeenCalled();
  });

  it("commits nothing when the blind slice is empty", async () => {
    const harness = createHarness();
    const runBacktest = vi.fn();
    const bars = buildBars(0);
    await expect(
      commitDee540BlindHoldout(
        harness.ex as never,
        baseInput(harness, {
          bars,
          expectedBlindDigest: computeBarSetDigest(buildBars(1)),
          runBacktest,
        }),
      ),
    ).rejects.toBeInstanceOf(BlindHoldoutValidationError);
    expect(harness.transactionCalls).toBe(0);
    expect(harness.committed()).toEqual([]);
    expect(runBacktest).not.toHaveBeenCalled();
  });

  it("commits nothing when the sealed digest does not match the bars", async () => {
    const harness = createHarness();
    const runBacktest = vi.fn();
    await expect(
      commitDee540BlindHoldout(
        harness.ex as never,
        baseInput(harness, {
          expectedBlindDigest: "ab".repeat(32),
          runBacktest,
        }),
      ),
    ).rejects.toBeInstanceOf(BlindHoldoutValidationError);
    expect(harness.transactionCalls).toBe(0);
    expect(harness.committed()).toEqual([]);
    expect(runBacktest).not.toHaveBeenCalled();
  });

  it("commits the consume and a terminal error row when the backtest throws after seeing the bars", async () => {
    const harness = createHarness();
    const bars = buildBars(3);
    const backtestError = new Error("backtest exploded");
    const runBacktest = vi.fn(async () => {
      throw backtestError;
    });
    await expect(
      commitDee540BlindHoldout(harness.ex as never, baseInput(harness, { bars, runBacktest })),
    ).rejects.toBe(backtestError);
    expect(runBacktest).toHaveBeenCalledWith(expect.objectContaining({ bars }));
    expect(committedConsumes(harness)).toEqual([
      { kind: "consume", blindDigest: computeBarSetDigest(bars) },
    ]);
    const results = committedResults(harness);
    expect(results).toHaveLength(1);
    expect(JSON.parse((results[0] as { metricsJson: string }).metricsJson)).toMatchObject({
      schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
      outcome: "error",
      phase: "backtest",
      message: "backtest exploded",
    });
    expect(harness.committed().some((entry) => entry.kind === "mark")).toBe(false);
    expect(harness.committed().some((entry) => entry.kind === "status")).toBe(false);
  });

  it("rolls the failed result insert back to the savepoint and still commits consume plus a terminal error row", async () => {
    const harness = createHarness({ failFirstResultInsert: true });
    const bars = buildBars(3);
    const metrics = buildMetrics();
    const insertError = new Error("result insert failure");
    await expect(
      commitDee540BlindHoldout(
        harness.ex as never,
        baseInput(harness, {
          bars,
          runBacktest: async () => metrics,
        }),
      ),
    ).rejects.toEqual(insertError);
    expect(committedConsumes(harness)).toEqual([
      { kind: "consume", blindDigest: computeBarSetDigest(bars) },
    ]);
    const results = committedResults(harness);
    expect(results).toHaveLength(1);
    expect(JSON.parse((results[0] as { metricsJson: string }).metricsJson)).toMatchObject({
      schemaVersion: DEE540_BLIND_TERMINAL_SCHEMA,
      outcome: "error",
      phase: "result_insert",
      message: "result insert failure",
    });
    expect(harness.committed().some((entry) => entry.kind === "mark")).toBe(false);
  });

  it("commits the consume and the success row together when the holdout completes", async () => {
    const harness = createHarness();
    const bars = buildBars(3);
    const metrics = buildMetrics();
    const outcome = await commitDee540BlindHoldout(
      harness.ex as never,
      baseInput(harness, {
        bars,
        runBacktest: async () => metrics,
      }),
    );
    expect(outcome.metrics).toEqual(metrics);
    expect(committedConsumes(harness)).toEqual([
      { kind: "consume", blindDigest: computeBarSetDigest(bars) },
    ]);
    const results = committedResults(harness);
    expect(results).toHaveLength(1);
    expect(JSON.parse((results[0] as { metricsJson: string }).metricsJson)).toMatchObject({
      schemaVersion: "1.0.0",
      tradeCount: 1,
    });
    expect(harness.committed().some((entry) => entry.kind === "mark")).toBe(true);
    expect(harness.committed()).toContainEqual({ kind: "status", status: "blind_validated" });
  });

  it("lets only one of two concurrent openers see the bars when the terminal insert throws", async () => {
    const harness = createHarness({ failAllResultInserts: true });
    const bars = buildBars(3);
    let seen = 0;
    const runBacktest = vi.fn(async () => {
      seen += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return buildMetrics();
    });
    const input = baseInput(harness, { bars, runBacktest });
    const settled = await Promise.allSettled([
      commitDee540BlindHoldout(harness.ex as never, input),
      commitDee540BlindHoldout(harness.ex as never, input),
    ]);
    expect(seen).toBe(1);
    expect(runBacktest).toHaveBeenCalledTimes(1);
    expect(settled.every((entry) => entry.status === "rejected")).toBe(true);
    const reasons = settled.map((entry) =>
      entry.status === "rejected" ? entry.reason : undefined,
    );
    expect(reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DEE540_AUTHORIZATION_ALREADY_CONSUMED" }),
        expect.objectContaining({ message: "terminal insert failed" }),
      ]),
    );
    expect(committedConsumes(harness)).toEqual([
      { kind: "consume", blindDigest: computeBarSetDigest(bars) },
    ]);
    expect(committedResults(harness)).toHaveLength(0);
  });
});
