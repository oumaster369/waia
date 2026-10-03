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
