import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildMsvEnvelope } from "@/lib/trader/intelligence/cde-v0";
import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { buildMarketUnderstandingBridge } from "@/lib/trader/intelligence/market-understanding-bridge-v0";
import {
  evaluateRegisteredStrategies,
  selectPrimaryStrategySignal,
} from "@/lib/trader/intelligence/strategies/registry";
import type {
  Bar,
  EvaluationCycleInput,
  EvaluationCycleResult,
  Quote,
} from "@/lib/trader/intelligence/types";
import { buildReplayFusedContext } from "@/lib/trader/market-data/replay-fused-context-builder";

function loadFixture() {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

function baseInput(fixture: ReturnType<typeof loadFixture>) {
  const evaluatedAt = fixture.bars.at(-1)!.barCloseTime;
  const fusedContext = buildReplayFusedContext({
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
    instrumentId: "BTC/USDT",
  });
  return {
    organizationId: "org-test",
    bars: fixture.bars,
    quote: fixture.latestQuote,
    evaluatedAt,
    fusedContext,
    newId: () => "eval-id",
  };
}

function serializeLegacyEvaluationCycleResult(result: EvaluationCycleResult): string {
  return JSON.stringify({
    features: result.features,
    msv: result.msv,
    signals: result.signals,
    signal: result.signal,
    fusedContext: result.fusedContext,
    understanding: result.understanding,
  });
}

function runLegacyEvaluationCycleReference(input: EvaluationCycleInput): EvaluationCycleResult {
  const newId = input.newId ?? crypto.randomUUID.bind(crypto);
  const evaluatedAt =
    input.evaluatedAt ?? input.bars.at(-1)?.barCloseTime ?? new Date().toISOString();

  const features = computeFeatureSnapshot({
    bars: input.bars,
    quote: input.quote,
    evaluatedAt,
    newId,
  });

  const understanding = input.fusedContext
    ? buildMarketUnderstandingBridge({
        fusedContext: input.fusedContext,
        features,
      })
    : undefined;

  const msv = buildMsvEnvelope({
    features,
    fusedContext: input.fusedContext,
    understanding,
    newId,
  });

  const signals = evaluateRegisteredStrategies(msv, features, {
    organizationId: input.organizationId,
    bars: input.bars,
    newId,
  });

  const signal = selectPrimaryStrategySignal(signals);

  return { features, msv, signals, signal, fusedContext: input.fusedContext, understanding };
}

describe("trader evaluation cycle MI core (PR-2)", () => {
  it("flag OFF produces byte-identical serialized output to legacy execution path", () => {
    const fixture = loadFixture();
    const input = baseInput(fixture);

    const flagOff = runEvaluationCycle({ ...input, miCoreEnabled: false });
    const legacyReference = runLegacyEvaluationCycleReference(input);
    const flagOffSerialized = serializeLegacyEvaluationCycleResult(flagOff);
    const legacySerialized = serializeLegacyEvaluationCycleResult(legacyReference);

    expect(flagOffSerialized).toBe(legacySerialized);
    expect(flagOff.reconstruction).toBeUndefined();
    expect(flagOff.hypothesisSet).toBeUndefined();
    expect(flagOff.marketStateSnapshot).toBeUndefined();
    expect(flagOff.decisionChain).toBeUndefined();
    expect(flagOff.hypothesisSessionState).toBeUndefined();
    expect(flagOff.msv.derived.conviction).toBeUndefined();

    const secondRun = runEvaluationCycle({ ...input, miCoreEnabled: false });
    expect(serializeLegacyEvaluationCycleResult(secondRun)).toBe(flagOffSerialized);
  });

  it("flag ON assembles market state snapshot and decision chain", () => {
    const fixture = loadFixture();
    const input = baseInput(fixture);

    const on = runEvaluationCycle({ ...input, miCoreEnabled: true });
    expect(on.reconstruction).toBeDefined();
    expect(on.hypothesisSet?.hypotheses).toHaveLength(8);
    expect(on.marketStateSnapshot).toBeDefined();
    expect(on.decisionChain?.terminalReasonCode).toBeTruthy();
    expect(on.decisionChain?.observation.terminalReasonCode).toBeTruthy();
    expect(on.hypothesisSessionState).toBeDefined();
  });

  it("produces deterministic digests on identical inputs", () => {
    const fixture = loadFixture();
    const input = baseInput(fixture);

    const first = runEvaluationCycle({ ...input, miCoreEnabled: true });
    const second = runEvaluationCycle({ ...input, miCoreEnabled: true });

    expect(first.reconstruction?.contentDigest).toBe(second.reconstruction?.contentDigest);
    expect(JSON.stringify(first.hypothesisSet)).toBe(JSON.stringify(second.hypothesisSet));
    expect(first.decisionChain?.terminalReasonCode).toBe(second.decisionChain?.terminalReasonCode);
  });

  it("threads session state across cycles", () => {
    const fixture = loadFixture();
    const input = baseInput(fixture);

    let sessionState = undefined;
    const states: string[] = [];
    for (let i = 0; i < 4; i++) {
      const result = runEvaluationCycle({
        ...input,
        miCoreEnabled: true,
        hypothesisSessionState: sessionState,
      });
      states.push(JSON.stringify(result.hypothesisSessionState));
      sessionState = result.hypothesisSessionState;
    }

    expect(states[0]).toBeDefined();
    const hasEvolution = states.some((state, index) => index > 0 && state !== states[0]);
    expect(
      hasEvolution || Object.keys(JSON.parse(states[0]!).peakConfidenceByType).length > 0,
    ).toBe(true);
  });

  it("market state snapshot is immutable in non-production", () => {
    const fixture = loadFixture();
    const input = baseInput(fixture);
    const result = runEvaluationCycle({ ...input, miCoreEnabled: true });
    expect(Object.isFrozen(result.marketStateSnapshot)).toBe(
      process.env.NODE_ENV === "production" ? false : true,
    );
  });
});
