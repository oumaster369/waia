import { describe, expect, it, vi } from "vitest";

import { createHistoricalExecutionModelV1 } from "@/lib/trader/execution/historical-execution-model";
import { deriveCurrentResearchTrainingPolicyV1 } from "@/lib/trader/research/research-training-policy-v1";
import {
  assertResearchModeledStageCycleAlignmentV1,
  runOwnedResearchModeledStageV1,
  sealOwnedResearchModeledStageDescriptorV1,
} from "@/lib/trader/research/research-modeled-stage-kernel-v1";
import type { ResearchModeledStageSourceV1 } from "@/lib/trader/research/research-modeled-stage-source-v1";

const ATTEMPT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function stagePayload(overrides: Record<string, unknown> = {}) {
  return {
    scope: {
      identity: {
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        organizationId: ORG_ID,
        parameters: { lookbackBars: 2, buyZscore: "-1.5", sellZscore: "0" },
      },
      ledgerScope: {
        organizationId: ORG_ID,
        historicalRunId: "run-1",
        historicalAccountKey: "acct",
      },
      contentDigest: "ab",
    },
    experiment: { spec: { universe: { symbol: "BTCUSDT" } } },
    bars: [],
    cycles: [],
    ...overrides,
  };
}

function executor() {
  return {
    select: vi.fn(() => {
      throw new Error("EXECUTOR_TOUCHED");
    }),
    insert: vi.fn(() => {
      throw new Error("EXECUTOR_TOUCHED");
    }),
    update: vi.fn(() => {
      throw new Error("EXECUTOR_TOUCHED");
    }),
    execute: vi.fn(() => {
      throw new Error("EXECUTOR_TOUCHED");
    }),
  };
}

function resolvedPolicy() {
  const current = deriveCurrentResearchTrainingPolicyV1();
  return Object.freeze({
    ...current,
    declaredQuantityCap: "0.5",
    requestedExecutableSourceSha256: "a".repeat(64),
    requestedPointInTimeEvidenceSha256: "b".repeat(64),
  });
}

function sealed() {
  const policy = resolvedPolicy();
  const model = createHistoricalExecutionModelV1();
  return {
    policy,
    descriptor: sealOwnedResearchModeledStageDescriptorV1({
      attemptId: ATTEMPT_ID,
      trialIndex: 0,
      policy,
      model,
    }),
  };
}

function payload(attemptId = ATTEMPT_ID, trialIndex = 0): ResearchModeledStageSourceV1 {
  return { scope: { identity: { attemptId, trialIndex } } } as ResearchModeledStageSourceV1;
}

/** JSON.parse defines an own `__proto__` data property. Assignment would not. */
function jsonOwnProto(extra: Record<string, unknown> = {}): object {
  const tail = Object.entries(extra)
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(",");
  const json =
    tail.length === 0
      ? '{"__proto__":{"scientificQualified":true,"declaredQuantityCap":"999"}}'
      : `{"__proto__":{"scientificQualified":true,"declaredQuantityCap":"999"},${tail}}`;
  return JSON.parse(json) as object;
}

function expectExecutorUntouched(db: ReturnType<typeof executor>) {
  expect(db.select).not.toHaveBeenCalled();
  expect(db.insert).not.toHaveBeenCalled();
  expect(db.update).not.toHaveBeenCalled();
  expect(db.execute).not.toHaveBeenCalled();
}

describe("owned research modeled stage kernel", () => {
  it("seals a descriptor that stays scientifically unqualified", () => {
    const { policy, descriptor } = sealed();
    expect(descriptor.attemptId).toBe(ATTEMPT_ID);
    expect(descriptor.trialIndex).toBe(0);
    expect(policy.scientificQualified).toBe(false);
    expect(policy.capitalEligible).toBe(false);
    expect(Object.isFrozen(descriptor)).toBe(true);
  });

  it("refuses caller bars, scorer, callback, stage label, receipt, and order repository before the executor", async () => {
    const { descriptor } = sealed();
    const db = executor();
    const forbidden = {
      bars: [{ close: "1" }],
      cycles: [],
      scorer: () => "caller",
      callbacks: { onFill: () => undefined },
      callback: () => "caller",
      stageLabel: "VALIDATION",
      stageKind: "blind",
      receipt: { scientificQualified: true },
      orderRepository: { insert: () => undefined },
      repository: { owner: "caller" },
      score: "caller-pass",
      result: { scientificQualified: true },
      source: payload(),
      request: { attemptId: ATTEMPT_ID, trialIndex: 0 },
      tx: db,
      policy: { scientificQualified: true },
      model: { venue: "caller" },
    };
    for (const [key, value] of Object.entries(forbidden)) {
      await expect(
        runOwnedResearchModeledStageV1({
          executor: db,
          descriptor,
          payload: payload(),
          [key]: value,
        } as never),
      ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:UNTRUSTED_STAGE_INPUT");
    }
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses an unsealed descriptor and a payload identity mismatch before the executor", async () => {
    const { descriptor, policy } = sealed();
    const db = executor();
    const model = createHistoricalExecutionModelV1();
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor: { attemptId: ATTEMPT_ID, trialIndex: 0, policy, model } as never,
        payload: payload(),
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: payload("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 1),
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_PAYLOAD_IDENTITY");
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses descriptor fields that would relabel the stage or supply bars", () => {
    const policy = resolvedPolicy();
    const model = createHistoricalExecutionModelV1();
    expect(() =>
      sealOwnedResearchModeledStageDescriptorV1({
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        policy,
        model,
        bars: [],
        stageLabel: "BLIND",
        scorer: () => 1,
      } as never),
    ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:UNTRUSTED_STAGE_DESCRIPTOR");
    expect(() =>
      sealOwnedResearchModeledStageDescriptorV1({
        attemptId: ATTEMPT_ID.toUpperCase(),
        trialIndex: 0,
        policy,
        model,
      }),
    ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_DESCRIPTOR");
  });

  it("refuses a transplanted brand symbol and a mutated unfrozen copy", async () => {
    const { descriptor } = sealed();
    const db = executor();
    const [brand] = Object.getOwnPropertySymbols(descriptor);
    expect(brand).toBeDefined();
    const brandProperty = Object.getOwnPropertyDescriptor(descriptor, brand!);
    const transplanted = {
      attemptId: ATTEMPT_ID,
      trialIndex: 0,
      policy: { ...resolvedPolicy(), scientificQualified: true, capitalEligible: true },
      model: createHistoricalExecutionModelV1(),
    };
    Object.defineProperty(transplanted, brand!, brandProperty!);
    transplanted.trialIndex = 4;
    expect(Object.isFrozen(transplanted)).toBe(false);
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor: transplanted as never,
        payload: payload(),
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");

    const frozenCopy = {
      attemptId: ATTEMPT_ID,
      trialIndex: 0,
      policy: resolvedPolicy(),
      model: createHistoricalExecutionModelV1(),
    };
    Object.defineProperty(frozenCopy, brand!, brandProperty!);
    Object.freeze(frozenCopy);
    expect(Object.isFrozen(frozenCopy)).toBe(true);
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor: frozenCopy as never,
        payload: payload(),
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses a payload getter that would swap bars on the second read", async () => {
    const { descriptor } = sealed();
    const db = executor();
    const verified = payload();
    const swapped = payload("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", 7);
    let reads = 0;
    const input = { executor: db, descriptor };
    Object.defineProperty(input, "payload", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? verified : swapped;
      },
    });
    await expect(runOwnedResearchModeledStageV1(input as never)).rejects.toThrow(
      "RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT",
    );
    expect(reads).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses payload bars and cycles accessors before the modeled loop", async () => {
    const { descriptor } = sealed();
    const db = executor();
    let reads = 0;
    const verifiedBars = Object.freeze([{ barOpenTime: "2026-01-01T00:00:00.000Z" }]);
    const swappedBars = Object.freeze([{ barOpenTime: "1999-01-01T00:00:00.000Z" }]);
    const stagePayload = {
      scope: { identity: { attemptId: ATTEMPT_ID, trialIndex: 0 } },
      cycles: Object.freeze([]),
    };
    Object.defineProperty(stagePayload, "bars", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? verifiedBars : swappedBars;
      },
    });
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: stagePayload as never,
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(reads).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses a proxy payload that could swap bars after the identity check", async () => {
    const { descriptor } = sealed();
    const db = executor();
    const verified = payload();
    const swappedBars = [{ barOpenTime: "1999-01-01T00:00:00.000Z" }];
    let reads = 0;
    const proxyPayload = new Proxy(verified, {
      get(target, key, receiver) {
        reads += 1;
        if (key === "bars") return reads > 1 ? swappedBars : [];
        return Reflect.get(target, key, receiver);
      },
    });
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: proxyPayload as never,
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses an index getter on bars and a field getter on cycle.barIndex", async () => {
    const { descriptor } = sealed();
    const db = executor();
    let indexReads = 0;
    const bars = Object.defineProperty([], "0", {
      enumerable: true,
      configurable: true,
      get() {
        indexReads += 1;
        return {
          barOpenTime: "2026-01-01T00:00:00.000Z",
          barCloseTime: "1999-01-01T00:00:00.000Z",
        };
      },
    });
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: stagePayload({ bars }) as never,
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(indexReads).toBe(0);

    let fieldReads = 0;
    const cycle = {
      cycleId: "cycle-1",
      closedBar: { barCloseTime: "2026-01-01T00:01:00.000Z" },
    };
    Object.defineProperty(cycle, "barIndex", {
      enumerable: true,
      configurable: true,
      get() {
        fieldReads += 1;
        return fieldReads === 1 ? 0 : 99;
      },
    });
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: stagePayload({ cycles: [cycle] }) as never,
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(fieldReads).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("refuses a cycles length getter that would grow the array", async () => {
    const { descriptor } = sealed();
    const db = executor();
    let reads = 0;
    const cycles = Object.create(Array.prototype) as object;
    Object.defineProperty(cycles, "0", {
      enumerable: true,
      configurable: true,
      value: {
        cycleId: "cycle-1",
        barIndex: 0,
        closedBar: { barCloseTime: "2026-01-01T00:01:00.000Z" },
      },
    });
    Object.defineProperty(cycles, "length", {
      configurable: true,
      get() {
        reads += 1;
        return reads;
      },
    });
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: stagePayload({ cycles }) as never,
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(reads).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("refuses a getter on experiment.spec.universe.symbol", async () => {
    const { descriptor } = sealed();
    const db = executor();
    let reads = 0;
    const universe = { venue: "HTX" };
    Object.defineProperty(universe, "symbol", {
      enumerable: true,
      configurable: true,
      get() {
        reads += 1;
        return reads === 1 ? "BTCUSDT" : "ETHUSDT";
      },
    });
    await expect(
      runOwnedResearchModeledStageV1({
        executor: db,
        descriptor,
        payload: stagePayload({ experiment: { spec: { universe } } }) as never,
      }),
    ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    expect(reads).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("keeps the snapshotted bar after the caller mutates it during the first await", async () => {
    const { descriptor } = sealed();
    const open = "2026-01-01T00:00:00.000Z";
    const close = "2026-01-01T00:01:00.000Z";
    const mutated = "1999-01-01T00:01:00.000Z";
    const bar = {
      symbol: "BTCUSDT",
      interval: "1m",
      open: "1",
      high: "1",
      low: "1",
      close: "1",
      volume: "1",
      barOpenTime: open,
      barCloseTime: close,
    };
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      organizationId: ORG_ID,
      accountKey: "acct",
      runId: "run-1",
      accountingSequence: 1,
      frontierAsOf: new Date(open),
      monthKey: "2026-01",
      cash: "100",
      positionQuantityJson: {},
      grossPositionBasisJson: {},
      netPositionBasisJson: {},
      grossRealizedPnl: "0",
      netRealizedPnl: "0",
      marksJson: {},
      markedPositionValue: "0",
      equity: "100",
      equityHwm: "100",
      monthlyPeakHwm: "100",
      monthlyDrawdownBps: 0,
      strategyPeakHwmByKeyJson: {},
      strategyDrawdownBpsByKeyJson: {},
      accountDrawdownBps: 0,
      sourceFillId: null,
      sourceEconomicsDigest: "c".repeat(64),
      semanticContentDigest: "d".repeat(64),
      idempotencyKey: "idem",
      schemaVersion: "htr-accounting-frontier/v1",
    };
    let selects = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => {
              selects += 1;
              return Promise.resolve(selects === 1 ? [] : [row]);
            },
          }),
        }),
      }),
      insert: () => ({
        values: () =>
          Promise.resolve().then(() => {
            bar.barCloseTime = mutated;
            bar.close = "999";
          }),
      }),
      update: () => {
        throw new Error("UPDATE_TOUCHED");
      },
      execute: () => {
        throw new Error("EXECUTE_TOUCHED");
      },
    };
    const error = await runOwnedResearchModeledStageV1({
      executor: db as never,
      descriptor,
      payload: stagePayload({
        bars: [bar],
        cycles: [{ cycleId: "cycle-1", barIndex: 0, closedBar: { barCloseTime: close } }],
      }) as never,
    }).then(
      () => {
        throw new Error("STAGE_RESOLVED");
      },
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("HISTORICAL_SEALED_MARKET_CYCLE_V2_INVALID");
    expect((error as Error).message).not.toContain(mutated);
    expect(bar.barCloseTime).toBe(mutated);
    expect(selects).toBeGreaterThan(0);
  });

  it("freezes a plain policy copy and refuses a proxy policy at seal", () => {
    const model = createHistoricalExecutionModelV1();
    const mutable = JSON.parse(JSON.stringify(resolvedPolicy())) as {
      declaredQuantityCap: string;
      scientificQualified: boolean;
      capitalEligible: boolean;
      portfolio: { runConfig: { startingBalanceUsdt: string } };
    };
    mutable.declaredQuantityCap = "0.5";
    mutable.scientificQualified = false;
    mutable.capitalEligible = false;
    const descriptor = sealOwnedResearchModeledStageDescriptorV1({
      attemptId: ATTEMPT_ID,
      trialIndex: 0,
      policy: mutable as ReturnType<typeof resolvedPolicy>,
      model,
    });
    mutable.declaredQuantityCap = "999";
    mutable.scientificQualified = true;
    mutable.capitalEligible = true;
    mutable.portfolio.runConfig.startingBalanceUsdt = "1";
    expect(descriptor.policy.declaredQuantityCap).toBe("0.5");
    expect(descriptor.policy.scientificQualified).toBe(false);
    expect(descriptor.policy.capitalEligible).toBe(false);
    expect(descriptor.policy.portfolio.runConfig.startingBalanceUsdt).not.toBe("1");
    expect(Object.getPrototypeOf(descriptor.policy)).toBe(Object.prototype);
    expect(Object.hasOwn(descriptor.policy, "__proto__")).toBe(false);
    expect(Object.hasOwn(descriptor.policy, "constructor")).toBe(false);
    expect(Object.hasOwn(descriptor.policy, "prototype")).toBe(false);
    expect(Object.isFrozen(descriptor.policy)).toBe(true);
    expect(Object.isFrozen(descriptor.model)).toBe(true);

    let reads = 0;
    const proxy = new Proxy(resolvedPolicy(), {
      get(target, key, receiver) {
        reads += 1;
        if (key === "scientificQualified" || key === "capitalEligible") return true;
        return Reflect.get(target, key, receiver);
      },
    });
    expect(() =>
      sealOwnedResearchModeledStageDescriptorV1({
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        policy: proxy as never,
        model,
      }),
    ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_DESCRIPTOR");
    expect(reads).toBe(0);
  });

  it("refuses an own __proto__ key from JSON.parse at policy, payload, bars, and cycles snapshots before the executor", async () => {
    const db = executor();
    const model = createHistoricalExecutionModelV1();
    const { descriptor } = sealed();
    const close = "2026-01-01T00:01:00.000Z";
    const sample = jsonOwnProto({ declaredQuantityCap: "0.5" });
    expect(Object.getPrototypeOf(sample)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(sample, "__proto__")?.value).toMatchObject({
      scientificQualified: true,
      declaredQuantityCap: "999",
    });

    const policyBase = JSON.parse(JSON.stringify(resolvedPolicy())) as Record<string, unknown>;
    expect(() =>
      sealOwnedResearchModeledStageDescriptorV1({
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        policy: jsonOwnProto(policyBase) as never,
        model,
      }),
    ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_DESCRIPTOR");
    expect(() =>
      sealOwnedResearchModeledStageDescriptorV1({
        attemptId: ATTEMPT_ID,
        trialIndex: 0,
        policy: resolvedPolicy(),
        model: jsonOwnProto({ venue: "caller" }) as never,
      }),
    ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_DESCRIPTOR");

    const identity = {
      attemptId: ATTEMPT_ID,
      trialIndex: 0,
      organizationId: ORG_ID,
      parameters: { lookbackBars: 2, buyZscore: "-1.5", sellZscore: "0" },
    };
    const ledgerScope = {
      organizationId: ORG_ID,
      historicalRunId: "run-1",
      historicalAccountKey: "acct",
    };
    const payloadSnapshots = [
      stagePayload({
        scope: {
          identity: { ...identity, parameters: jsonOwnProto({ lookbackBars: 2 }) },
          ledgerScope,
          contentDigest: "ab",
        },
      }),
      stagePayload({
        scope: {
          identity,
          ledgerScope: jsonOwnProto(ledgerScope),
          contentDigest: "ab",
        },
      }),
      stagePayload({
        experiment: { spec: jsonOwnProto({ universe: { symbol: "BTCUSDT" } }) },
      }),
      stagePayload({ bars: jsonOwnProto({ close: "1" }) }),
      stagePayload({
        cycles: jsonOwnProto({ cycleId: "cycle-1", barIndex: 0 }),
      }),
      stagePayload({
        bars: [jsonOwnProto({ close: "1", barCloseTime: close })],
      }),
      stagePayload({
        cycles: [
          jsonOwnProto({
            cycleId: "cycle-1",
            barIndex: 0,
            closedBar: { barCloseTime: close },
          }),
        ],
      }),
    ];
    for (const body of payloadSnapshots) {
      await expect(
        runOwnedResearchModeledStageV1({
          executor: db,
          descriptor,
          payload: body as never,
        }),
      ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    }
    expectExecutorUntouched(db);
    expect("scientificQualified" in Object.prototype).toBe(false);
    expect("declaredQuantityCap" in Object.prototype).toBe(false);
  });

  it("refuses own constructor and prototype keys in a snapshotted policy and bar", async () => {
    const db = executor();
    const model = createHistoricalExecutionModelV1();
    const { descriptor } = sealed();
    for (const key of ["constructor", "prototype"] as const) {
      const policy = JSON.parse(
        `{"${key}":{"scientificQualified":true,"declaredQuantityCap":"999"},"declaredQuantityCap":"0.5","scientificQualified":false,"capitalEligible":false}`,
      );
      expect(() =>
        sealOwnedResearchModeledStageDescriptorV1({
          attemptId: ATTEMPT_ID,
          trialIndex: 0,
          policy: policy as never,
          model,
        }),
      ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_DESCRIPTOR");
      await expect(
        runOwnedResearchModeledStageV1({
          executor: db,
          descriptor,
          payload: stagePayload({
            bars: [JSON.parse(`{"${key}":{"scientificQualified":true},"close":"1"}`)],
          }) as never,
        }),
      ).rejects.toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:STAGE_INPUT");
    }
    expectExecutorUntouched(db);
    expect(descriptor.policy.scientificQualified).toBe(false);
    expect(descriptor.policy.capitalEligible).toBe(false);
  });

  it("refuses non-enumerable and symbol keys on the call and the sealer before the executor", async () => {
    const { descriptor, policy } = sealed();
    const model = createHistoricalExecutionModelV1();
    const db = executor();
    const hiddenCall = { executor: db, descriptor, payload: payload() };
    Object.defineProperty(hiddenCall, "scientificQualified", {
      value: true,
      enumerable: false,
      configurable: true,
      writable: true,
    });
    await expect(runOwnedResearchModeledStageV1(hiddenCall as never)).rejects.toThrow(
      "RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:UNTRUSTED_STAGE_INPUT",
    );

    const symbolCall = { executor: db, descriptor, payload: payload() };
    Object.defineProperty(symbolCall, Symbol("capitalEligible"), {
      value: true,
      enumerable: false,
      configurable: true,
    });
    await expect(runOwnedResearchModeledStageV1(symbolCall as never)).rejects.toThrow(
      "RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:UNTRUSTED_STAGE_INPUT",
    );

    const hiddenSeal = { attemptId: ATTEMPT_ID, trialIndex: 0, policy, model };
    Object.defineProperty(hiddenSeal, "bars", {
      value: [{ close: "1" }],
      enumerable: false,
      configurable: true,
      writable: true,
    });
    expect(() => sealOwnedResearchModeledStageDescriptorV1(hiddenSeal as never)).toThrow(
      "RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:UNTRUSTED_STAGE_DESCRIPTOR",
    );

    const symbolSeal = { attemptId: ATTEMPT_ID, trialIndex: 0, policy, model };
    Object.defineProperty(symbolSeal, Symbol("stageLabel"), { value: "BLIND" });
    expect(() => sealOwnedResearchModeledStageDescriptorV1(symbolSeal as never)).toThrow(
      "RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:UNTRUSTED_STAGE_DESCRIPTOR",
    );
    expectExecutorUntouched(db);
    expect(policy.scientificQualified).toBe(false);
    expect(policy.capitalEligible).toBe(false);
  });

  it("keeps the local stage index separate from a nonzero absolute source bar index", () => {
    const close = "2026-01-01T00:05:00.000Z";
    expect(assertResearchModeledStageCycleAlignmentV1(4, 0, 4, close, close)).toEqual({
      index: 0,
      sourceBarIndex: 4,
    });
    expect(assertResearchModeledStageCycleAlignmentV1(4, 4, 8, close, close)).toEqual({
      index: 4,
      sourceBarIndex: 8,
    });
    expect(() => assertResearchModeledStageCycleAlignmentV1(4, 4, 4, close, close)).toThrow(
      "RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:CYCLE_INDEX_MISMATCH",
    );
    expect(() =>
      assertResearchModeledStageCycleAlignmentV1(4, 4, 8, close, "2026-01-01T00:06:00.000Z"),
    ).toThrow("RESEARCH_TRAINING_DIAGNOSTIC_REFUSED:CYCLE_INDEX_MISMATCH");
  });
});
