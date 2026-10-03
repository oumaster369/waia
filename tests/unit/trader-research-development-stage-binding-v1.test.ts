import { describe, expect, it, vi } from "vitest";

import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import {
  runBoundDevelopmentModeledStagesV1,
  sealResearchDevelopmentStageRegistrationV1,
} from "@/lib/trader/research/research-development-stage-binding-v1";
import { RESEARCH_EXECUTABLE_ID_V1 } from "@/lib/trader/research/research-experiment-contract-v1";
import * as modeledStageKernel from "@/lib/trader/research/research-modeled-stage-kernel-v1";
import type { OwnedResearchStageExecutorV1 } from "@/lib/trader/research/research-modeled-stage-kernel-v1";
import type { ResearchModeledStageSourceV1 } from "@/lib/trader/research/research-modeled-stage-source-v1";
import { deriveCurrentResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";

const ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SOURCE_SHA = "a".repeat(64);
const PIT_SHA = "b".repeat(64);
const DATASET_SHA = "c".repeat(64);
const TRAIN_PARTITION = "d".repeat(64);
const VALIDATION_PARTITION = "e".repeat(64);
const WALK_PARTITION = "1".repeat(64);
const PARAMETERS = Object.freeze({ lookbackBars: 8, buyZscore: "-1.5", sellZscore: "0" });

function policy() {
  const current = deriveCurrentResearchTrainingPolicyV1();
  return Object.freeze({
    ...current,
    declaredQuantityCap: "0.5",
    requestedExecutableSourceSha256: SOURCE_SHA,
    requestedPointInTimeEvidenceSha256: PIT_SHA,
  });
}

function spec(overrides: Record<string, unknown> = {}) {
  const resolved = policy();
  return {
    executable: {
      id: RESEARCH_EXECUTABLE_ID_V1,
      sourceSha256: SOURCE_SHA,
      featureSemantics: "closed-prefix-sma-population-zscore/v1",
      replaySemantics: "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1",
    },
    costs: { ...resolved.costAuthority },
    universe: {
      venue: "HTX",
      market: "SPOT",
      symbol: "BTCUSDT",
      interval: "1m",
      pointInTimeEvidenceSha256: PIT_SHA,
      datasetSourceSha256: DATASET_SHA,
    },
    orderedTrials: [PARAMETERS],
    partitions: {
      train: { contentSha256: TRAIN_PARTITION },
      validation: { contentSha256: VALIDATION_PARTITION },
      walkForward: [{ contentSha256: WALK_PARTITION }],
    },
    ...overrides,
  };
}

function payload(
  contentSha256: string,
  overrides: Record<string, unknown> = {},
): ResearchModeledStageSourceV1 {
  const experimentSpec = spec();
  return {
    scope: {
      identity: {
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        organizationId: ORG_ID,
        parameters: PARAMETERS,
      },
      contentDigest: "2".repeat(64),
      ledgerScope: { historicalRunId: "run-1", historicalAccountKey: "acct" },
    },
    experiment: { spec: experimentSpec, specSha256: computeStableJsonDigest(experimentSpec) },
    partition: { contentSha256 },
    bars: [],
    cycles: [],
    ...overrides,
  } as unknown as ResearchModeledStageSourceV1;
}

function owned(db: ReturnType<typeof executor>["db"]): OwnedResearchStageExecutorV1 {
  return db as unknown as OwnedResearchStageExecutorV1;
}

function stages() {
  return [
    { kind: "train" as const, windowIndex: 0, payload: payload(TRAIN_PARTITION) },
    { kind: "validation" as const, windowIndex: 0, payload: payload(VALIDATION_PARTITION) },
    { kind: "walk-forward" as const, windowIndex: 0, payload: payload(WALK_PARTITION) },
  ];
}

function registrationFor(experimentSpec = spec()) {
  return sealResearchDevelopmentStageRegistrationV1({
    attemptId: ATTEMPT_ID,
    trialIndex: 0,
    specSha256: computeStableJsonDigest(experimentSpec),
    committedBeforeScoring: true,
  });
}

function descriptor() {
  return modeledStageKernel.sealOwnedResearchModeledStageDescriptorV1({
    attemptId: ATTEMPT_ID,
    trialIndex: 0,
    policy: policy(),
    model: createHistoricalExecutionModelV1(),
  });
}

function statementText(query: unknown): string {
  if (!query || typeof query !== "object" || !("queryChunks" in query))
    return JSON.stringify(query);
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  const parts: string[] = [];
  for (const chunk of chunks) {
    if (!chunk || typeof chunk !== "object" || !("value" in chunk)) continue;
    const value = (chunk as { value: unknown }).value;
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) {
      parts.push(value.join(""));
    }
  }
  return parts.join(" ");
}

function statementParameters(query: unknown): unknown[] {
  if (!query || typeof query !== "object" || !("queryChunks" in query)) return [];
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  const parameters: unknown[] = [];
  for (const chunk of chunks) {
    if (typeof chunk === "string" || typeof chunk === "number" || typeof chunk === "boolean") {
      parameters.push(chunk);
      continue;
    }
    if (!chunk || typeof chunk !== "object" || !("value" in chunk)) continue;
    const value = (chunk as { value: unknown }).value;
    if (Array.isArray(value) && value.every((part) => typeof part === "string")) continue;
    parameters.push(value);
  }
  return parameters;
}

function isValidationCanonical(value: unknown): value is string {
  if (typeof value !== "string" || !value.includes('"stage"')) return false;
  try {
    const parsed = JSON.parse(value) as { stage?: unknown };
    return parsed.stage === "validation";
  } catch {
    return false;
  }
}

function executor(rows: readonly Record<string, unknown>[] = []) {
  const calls: unknown[] = [];
  const committed: Record<string, unknown>[] = [...rows];
  let queue: Promise<void> = Promise.resolve();
  const ports = {
    select: vi.fn(() => {
      throw new Error("SELECT_TOUCHED");
    }),
    insert: vi.fn(() => {
      throw new Error("INSERT_TOUCHED");
    }),
    update: vi.fn(() => {
      throw new Error("UPDATE_TOUCHED");
    }),
  };

  function apply(query: unknown, bucket: Record<string, unknown>[]): unknown[] {
    calls.push(query);
    const text = statementText(query);
    if (text.includes("pg_advisory_xact_lock")) return [];
    if (text.includes("select receipt_canonical_json")) {
      return bucket.filter((row) => isValidationCanonical(row.receipt_canonical_json));
    }
    const canonical = statementParameters(query).find(
      (value) =>
        isValidationCanonical(value) ||
        (typeof value === "string" && value.includes('"schemaVersion"')),
    );
    if (text.includes("insert into") && typeof canonical === "string") {
      bucket.push({ receipt_canonical_json: canonical });
      return [];
    }
    if (text.includes("update ") && typeof canonical === "string") {
      const index = bucket.findIndex((row) => isValidationCanonical(row.receipt_canonical_json));
      if (index < 0) return [];
      bucket[index] = { receipt_canonical_json: canonical };
      return [{ receipt_sha256: "updated" }];
    }
    return [];
  }

  const db = {
    ...ports,
    execute: vi.fn(async (query: unknown) => apply(query, committed)),
    transaction: vi.fn(async (run: (tx: OwnedResearchStageExecutorV1) => Promise<unknown>) => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const previous = queue;
      queue = gate;
      await previous;
      const pending = committed.map((row) => ({ ...row }));
      const tx = {
        ...ports,
        execute: vi.fn(async (query: unknown) => apply(query, pending)),
      };
      try {
        const result = await run(tx as unknown as OwnedResearchStageExecutorV1);
        committed.splice(0, committed.length, ...pending);
        return result;
      } finally {
        release();
      }
    }),
  };
  return { calls, db };
}

function runnerResult(scientificQualified = false) {
  return {
    accounting: { semanticContentDigest: "9".repeat(64) },
    decisions: [{ id: "decision" }],
    invocations: [{ contentDigestHex: "8".repeat(64) }],
    advances: [],
    fillDetails: [{ id: "fill" }],
    orderRows: [{ id: "order" }],
    openOrderIds: [],
    scientificQualified,
    capitalEligible: true,
  };
}

describe("development modeled stage binding", () => {
  it("runs train, validation, and walk-forward only through the sealed kernel and records runner receipts", async () => {
    const { db, calls } = executor();
    const kernel = vi
      .spyOn(modeledStageKernel, "runOwnedResearchModeledStageV1")
      .mockImplementation(async () => {
        expect(JSON.stringify(calls)).toContain("VALIDATION_RESERVATION");
        return runnerResult(true) as never;
      });
    try {
      const receipts = await runBoundDevelopmentModeledStagesV1({
        executor: owned(db),
        descriptor: descriptor(),
        registration: registrationFor(),
        stages: stages(),
      });
      expect(kernel).toHaveBeenCalledTimes(3);
      for (const call of kernel.mock.calls) {
        expect(Object.keys(call[0])).toEqual(["executor", "descriptor", "payload"]);
        expect(Object.isFrozen(call[0].payload)).toBe(true);
      }
      expect(kernel.mock.calls.map((call) => call[0].payload.partition.contentSha256)).toEqual([
        TRAIN_PARTITION,
        VALIDATION_PARTITION,
        WALK_PARTITION,
      ]);
      expect(receipts.map((receipt) => receipt.stage)).toEqual([
        "train",
        "validation",
        "walk-forward",
      ]);
      for (const receipt of receipts) {
        expect(receipt.scientificQualified).toBe(false);
        expect(receipt.capitalEligible).toBe(false);
        expect(receipt.provenance).toBe("RUNNER_OBSERVED");
        expect(receipt.executableId).toBe(RESEARCH_EXECUTABLE_ID_V1);
        expect(receipt.executableSourceSha256).toBe(SOURCE_SHA);
        expect(receipt.observedDecisionCount).toBe(1);
        expect(receipt.observedInvocationCount).toBe(1);
        expect(receipt.parametersSha256).toBe(computeStableJsonDigest(PARAMETERS));
        expect(receipt.contentDigestHex).toMatch(/^[a-f0-9]{64}$/);
      }
      const persisted = JSON.stringify(calls);
      expect(persisted).toContain("select receipt_canonical_json");
      expect(persisted).toContain(receipts[1]!.contentDigestHex);
      expect(persisted).not.toContain('"scientificQualified":true');
    } finally {
      kernel.mockRestore();
    }
  });

  it("refuses a second validation selection from the receipt the runner persisted", async () => {
    const kernel = vi
      .spyOn(modeledStageKernel, "runOwnedResearchModeledStageV1")
      .mockResolvedValue(runnerResult() as never);
    const first = executor();
    let validationCanonical = "";
    try {
      const receipts = await runBoundDevelopmentModeledStagesV1({
        executor: owned(first.db),
        descriptor: descriptor(),
        registration: registrationFor(),
        stages: stages(),
      });
      validationCanonical = JSON.stringify(receipts[1]);
    } finally {
      kernel.mockRestore();
    }
    const kernelAgain = vi.spyOn(modeledStageKernel, "runOwnedResearchModeledStageV1");
    const second = executor([{ receipt_canonical_json: validationCanonical }]);
    await expect(
      runBoundDevelopmentModeledStagesV1({
        executor: owned(second.db),
        descriptor: descriptor(),
        registration: registrationFor(),
        stages: [{ kind: "validation", windowIndex: 0, payload: payload(VALIDATION_PARTITION) }],
      }),
    ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:REPEATED_VALIDATION_SELECTION");
    expect(kernelAgain).not.toHaveBeenCalled();
    expect(JSON.stringify(second.calls)).not.toContain("insert into");
    kernelAgain.mockRestore();
  });

  it("refuses forged callbacks, identity mismatches, late registration, and blind before the executor", async () => {
    const { db, calls } = executor();
    const bound = descriptor();
    const registered = registrationFor();
    const base = {
      executor: owned(db),
      descriptor: bound,
      registration: registered,
      stages: stages(),
    };
    const cases: Array<readonly [string, Record<string, unknown>]> = [
      ["FORGED_CALLBACK", { ...base, runBacktest: () => "caller" }],
      ["FORGED_CALLBACK", { ...base, callback: () => "caller" }],
      ["FORGED_CALLBACK", { ...base, scorer: () => 1 }],
      ["LATE_REGISTRATION", { executor: owned(db), descriptor: bound, stages: stages() }],
      [
        "LATE_REGISTRATION",
        {
          ...base,
          registration: {
            attemptId: ATTEMPT_ID,
            trialIndex: 0,
            specSha256: computeStableJsonDigest(spec()),
            committedBeforeScoring: true,
          },
        },
      ],
      [
        "REPEATED_VALIDATION_SELECTION",
        {
          ...base,
          stages: [
            { kind: "validation", windowIndex: 0, payload: payload(VALIDATION_PARTITION) },
            { kind: "validation", windowIndex: 0, payload: payload(VALIDATION_PARTITION) },
          ],
        },
      ],
      [
        "BLIND_OUT_OF_SCOPE",
        { ...base, stages: [{ kind: "blind", windowIndex: 0, payload: payload(TRAIN_PARTITION) }] },
      ],
      [
        "PARAMS_MISMATCH",
        {
          ...base,
          stages: [
            {
              kind: "train",
              windowIndex: 0,
              payload: payload(TRAIN_PARTITION, {
                scope: {
                  identity: {
                    attemptId: ATTEMPT_ID,
                    trialIndex: 0,
                    organizationId: ORG_ID,
                    parameters: { ...PARAMETERS, lookbackBars: 5 },
                  },
                  contentDigest: "2".repeat(64),
                  ledgerScope: { historicalRunId: "run-1", historicalAccountKey: "acct" },
                },
              }),
            },
          ],
        },
      ],
    ];
    for (const [reason, input] of cases) {
      await expect(runBoundDevelopmentModeledStagesV1(input as never)).rejects.toThrow(
        `RESEARCH_DEVELOPMENT_STAGE_REFUSED:${reason}`,
      );
    }
    const mismatchedCost = spec();
    mismatchedCost.costs = { ...mismatchedCost.costs, costModelDigest: "0".repeat(64) };
    await expect(
      runBoundDevelopmentModeledStagesV1({
        ...base,
        registration: registrationFor(mismatchedCost),
        stages: [
          {
            kind: "train",
            windowIndex: 0,
            payload: {
              ...payload(TRAIN_PARTITION),
              experiment: {
                spec: mismatchedCost,
                specSha256: computeStableJsonDigest(mismatchedCost),
              },
            } as unknown as ResearchModeledStageSourceV1,
          },
        ],
      }),
    ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:COST_MISMATCH");
    const otherUniverse = spec({
      universe: { ...spec().universe, symbol: "ETHUSDT" },
    });
    await expect(
      runBoundDevelopmentModeledStagesV1({
        ...base,
        stages: [
          { kind: "train", windowIndex: 0, payload: payload(TRAIN_PARTITION) },
          {
            kind: "validation",
            windowIndex: 0,
            payload: {
              ...payload(VALIDATION_PARTITION),
              experiment: {
                spec: otherUniverse,
                specSha256: computeStableJsonDigest(otherUniverse),
              },
              partition: { contentSha256: VALIDATION_PARTITION },
            } as unknown as ResearchModeledStageSourceV1,
          },
        ],
      }),
    ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:UNIVERSE_MISMATCH");
    const otherEvaluator = spec({
      executable: { ...spec().executable, id: "caller.mean-reversion.v0" },
    });
    await expect(
      runBoundDevelopmentModeledStagesV1({
        ...base,
        registration: registrationFor(otherEvaluator),
        stages: [
          {
            kind: "validation",
            windowIndex: 0,
            payload: {
              ...payload(VALIDATION_PARTITION),
              experiment: {
                spec: otherEvaluator,
                specSha256: computeStableJsonDigest(otherEvaluator),
              },
            } as unknown as ResearchModeledStageSourceV1,
          },
        ],
      }),
    ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:EVALUATOR_MISMATCH");
    expect(calls).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses an unsealed descriptor inside the kernel before a receipt write", async () => {
    const resolved = policy();
    const { db, calls } = executor();
    await expect(
      runBoundDevelopmentModeledStagesV1({
        executor: owned(db),
        descriptor: {
          attemptId: ATTEMPT_ID,
          trialIndex: 0,
          policy: resolved,
          model: createHistoricalExecutionModelV1(),
        } as never,
        registration: registrationFor(),
        stages: [{ kind: "train", windowIndex: 0, payload: payload(TRAIN_PARTITION) }],
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    const persisted = JSON.stringify(calls);
    expect(persisted).toContain("pg_advisory_xact_lock");
    expect(persisted).toContain("select receipt_canonical_json");
    expect(persisted).not.toContain("insert into");
  });

  it("refuses a registration sealed with a score, bars, or a spec that was not committed", () => {
    expect(() =>
      sealResearchDevelopmentStageRegistrationV1({
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        specSha256: "0".repeat(64),
        committedBeforeScoring: true,
        score: 1,
      } as never),
    ).toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:FORGED_CALLBACK");
    expect(() =>
      sealResearchDevelopmentStageRegistrationV1({
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        specSha256: "0".repeat(64),
        committedBeforeScoring: false,
      } as never),
    ).toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:LATE_REGISTRATION");
  });

  it("refuses a sealed policy that claims scientific qualification before the executor", async () => {
    const qualified = policy() as {
      scientificQualified: boolean;
      capitalEligible: boolean;
    };
    const mutable = { ...qualified, scientificQualified: true, capitalEligible: false };
    const { db, calls } = executor();
    await expect(
      runBoundDevelopmentModeledStagesV1({
        executor: owned(db),
        descriptor: modeledStageKernel.sealOwnedResearchModeledStageDescriptorV1({
          attemptId: ATTEMPT_ID,
          trialIndex: 0,
          policy: mutable as never,
          model: createHistoricalExecutionModelV1(),
        }),
        registration: registrationFor(),
        stages: [{ kind: "train", windowIndex: 0, payload: payload(TRAIN_PARTITION) }],
      }),
    ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:SCIENTIFIC_QUALIFICATION_UNAVAILABLE");
    expect(calls).toEqual([]);
  });

  it("refuses a proxy, an array subclass, or an own map before the executor runs", async () => {
    const kernel = vi.spyOn(modeledStageKernel, "runOwnedResearchModeledStageV1");
    const { db, calls } = executor();
    const base = {
      executor: owned(db),
      descriptor: descriptor(),
      registration: registrationFor(),
    };
    let proxyTouched = false;
    const proxy = new Proxy(stages(), {
      get() {
        proxyTouched = true;
        return () => [];
      },
    });
    let subclassMapped = false;
    class HostileStages extends Array {
      override map(): never[] {
        subclassMapped = true;
        return [];
      }
    }
    const subclass = new HostileStages();
    for (const stage of stages()) subclass.push(stage);
    let ownMapped = false;
    const ownMap = stages();
    Object.defineProperty(ownMap, "map", {
      value: () => {
        ownMapped = true;
        return [];
      },
      configurable: true,
      writable: true,
    });
    for (const hostile of [proxy, subclass, ownMap]) {
      await expect(
        runBoundDevelopmentModeledStagesV1({ ...base, stages: hostile as never }),
      ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:STAGE_INPUT");
    }
    expect(proxyTouched).toBe(false);
    expect(subclassMapped).toBe(false);
    expect(ownMapped).toBe(false);
    expect(kernel).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
    kernel.mockRestore();
  });

  it("reserves validation before scoring so a concurrent caller and a crash retry cannot score it twice", async () => {
    let releaseScore: () => void = () => undefined;
    const scoreEntered = new Promise<void>((resolve) => {
      releaseScore = resolve;
    });
    let scoring = false;
    const kernel = vi
      .spyOn(modeledStageKernel, "runOwnedResearchModeledStageV1")
      .mockImplementation(async () => {
        scoring = true;
        await scoreEntered;
        return runnerResult() as never;
      });
    const shared = executor();
    const input = {
      executor: owned(shared.db),
      descriptor: descriptor(),
      registration: registrationFor(),
      stages: [
        { kind: "validation" as const, windowIndex: 0, payload: payload(VALIDATION_PARTITION) },
      ],
    };
    const first = runBoundDevelopmentModeledStagesV1(input);
    const started = Date.now();
    while (!scoring) {
      if (Date.now() - started > 2000) throw new Error("validation score did not start");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    let secondScored = false;
    const kernelCallsAtOverlap = kernel.mock.calls.length;
    const second = runBoundDevelopmentModeledStagesV1(input).then(
      () => {
        secondScored = true;
      },
      (error: unknown) => error,
    );
    releaseScore();
    await first;
    const secondResult = await second;
    expect(secondScored).toBe(false);
    expect(secondResult).toBeInstanceOf(Error);
    expect((secondResult as Error).message).toContain(
      "RESEARCH_DEVELOPMENT_STAGE_REFUSED:REPEATED_VALIDATION_SELECTION",
    );
    expect(kernel.mock.calls.length).toBe(kernelCallsAtOverlap);

    kernel.mockImplementation(async () => {
      throw new Error("CRASH_AFTER_VALIDATION_SCORE");
    });
    const retryDb = executor();
    const retry = {
      executor: owned(retryDb.db),
      descriptor: descriptor(),
      registration: registrationFor(),
      stages: [
        { kind: "validation" as const, windowIndex: 0, payload: payload(VALIDATION_PARTITION) },
      ],
    };
    await expect(runBoundDevelopmentModeledStagesV1(retry)).rejects.toThrow(
      "CRASH_AFTER_VALIDATION_SCORE",
    );
    expect(kernel).toHaveBeenCalledTimes(kernelCallsAtOverlap + 1);
    await expect(
      runBoundDevelopmentModeledStagesV1({
        ...retry,
        registration: registrationFor(),
      }),
    ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:REPEATED_VALIDATION_SELECTION");
    expect(kernel).toHaveBeenCalledTimes(kernelCallsAtOverlap + 1);
    kernel.mockRestore();
  });

  it("refuses qualification accessors before any executor call", async () => {
    const { db, calls } = executor();
    const kernel = vi.spyOn(modeledStageKernel, "runOwnedResearchModeledStageV1");
    let reads = 0;
    const current = policy();
    const scientific = { ...current };
    Object.defineProperty(scientific, "scientificQualified", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        void db.execute("scientific-qualified");
        return false;
      },
    });
    const capital = { ...current, scientificQualified: false as const };
    Object.defineProperty(capital, "capitalEligible", {
      configurable: true,
      enumerable: true,
      get() {
        reads += 1;
        void db.execute("capital-eligible");
        return false;
      },
    });
    for (const hostile of [scientific, capital]) {
      await expect(
        runBoundDevelopmentModeledStagesV1({
          executor: owned(db),
          descriptor: {
            attemptId: ATTEMPT_ID,
            trialIndex: 0,
            policy: hostile,
            model: createHistoricalExecutionModelV1(),
          } as never,
          registration: registrationFor(),
          stages: [{ kind: "train", windowIndex: 0, payload: payload(TRAIN_PARTITION) }],
        }),
      ).rejects.toThrow("RESEARCH_DEVELOPMENT_STAGE_REFUSED:SCIENTIFIC_QUALIFICATION_UNAVAILABLE");
    }
    expect(reads).toBe(0);
    expect(calls).toEqual([]);
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(kernel).not.toHaveBeenCalled();
    kernel.mockRestore();
  });
});
