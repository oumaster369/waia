import {
  ACCOUNTING_BASIS_METHOD,
  ACCOUNTING_ENGINE_ID,
  ACCOUNTING_FRONTIER_SCHEMA_VERSION,
  computeAccountingSemanticDigest,
} from "@/lib/trader/accounting";
import {
  buildDecisionEconomicsV2Record,
  buildV2WhyNotCashJson,
  decisionEvRangeFromRecord,
} from "@/lib/trader/intelligence/decision-economics/decision-economics-v2-service";
import { evaluateCapitalLimits } from "@/lib/trader/risk/capital-limits-evaluator";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { toCapitalLimitsConfig } from "@/lib/trader/risk/limits/types";
import {
  CONTROL_REPLAY_AUTHORITY_IDENTITY,
  assertControlReplayTestOnlyAuthorityV1,
  TestOnlyAuthorityRejectedError,
} from "@/lib/trader/observability/control-replay-test-authority";
import {
  assertControlReplayParityEqual,
  computeControlReplayParityDigest,
} from "@/lib/trader/observability/fhv-control-replay-parity-digest";

export const CONTROL_REPLAY_RUNTIME_FIXTURE_VERSION = "control-replay-runtime-fixture/v1" as const;

export type ControlReplayRuntimeFixtureResult = {
  parityDigest: string;
  decisionActionable: boolean;
  riskOutcome: string;
  accountingSemanticDigest: string;
  authority: typeof CONTROL_REPLAY_AUTHORITY_IDENTITY;
};

function fixtureReplicaSamples(): number[][][] {
  return [
    [
      [0, 0, 0, 0.01, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0.02, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0.015, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    ],
  ];
}

function runRiskGateForFixture(): { outcome: string; orderId: string; fillId: string } {
  const riskDecision = evaluateCapitalLimits(
    {
      order: {
        clientOrderId: "control-replay-fixture-order",
        symbol: "BTC/USDT",
        side: "buy",
        type: "market",
        quantity: "0.01",
      },
      referencePrice: "50000",
      accountState: {
        positions: [],
        openOrderCount: 0,
        dailyPnl: "0",
        drawdown: "0",
        quoteExposureByCurrency: {},
      },
    },
    toCapitalLimitsConfig(DEFAULT_ORG_RISK_LIMITS),
    { nowMs: () => 1_700_000_000_000 },
  );
  return {
    outcome: riskDecision.outcome,
    orderId: "00000000-0000-4000-8000-000000000020",
    fillId: "00000000-0000-4000-8000-000000000021",
  };
}

function runAccountingFixture(input: {
  organizationId: string;
  runId: string;
  fillId: string;
}): string {
  return computeAccountingSemanticDigest({
    schemaVersion: ACCOUNTING_FRONTIER_SCHEMA_VERSION,
    engineId: ACCOUNTING_ENGINE_ID,
    basisMethod: ACCOUNTING_BASIS_METHOD,
    organizationId: input.organizationId,
    accountKey: "default",
    runId: input.runId,
    accountingSequence: 1,
    frontierAsOf: "2024-01-01T00:00:00.000Z",
    monthKey: "2024-01",
    cash: "100000",
    positions: {},
    grossRealizedPnl: "0",
    netRealizedPnl: "0",
    marks: { "BTC/USDT": { price: "50000", barCloseTime: "2024-01-01T00:00:00.000Z" } },
    markedPositionValue: "0",
    equity: "100000",
    equityHwm: "100000",
    accountDrawdownBps: 0,
    consumedFillIds: [input.fillId],
  });
}

/** Deterministic local fixture through Decision V2 economics, Risk, mock execution, Accounting. */
export function runControlReplayRuntimeFixtureV1(): ControlReplayRuntimeFixtureResult {
  assertControlReplayTestOnlyAuthorityV1({
    surface: "CONTROL_REPLAY",
    authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
  });

  for (const surface of ["production", "FULL_HISTORICAL", "shadow", "live"] as const) {
    expectEscapePrevented(surface);
  }

  const organizationId = "00000000-0000-4000-8000-000000000001";
  const forecastId = "00000000-0000-4000-8000-000000000002";
  const economics = buildDecisionEconomicsV2Record({
    organizationId,
    forecastId,
    notionalUsdt: 10_000,
    costRate: 0.001,
    slippageBufferUsdt: 5,
    replicaSamples: fixtureReplicaSamples(),
    scientificAdmissionReceiptDigest: "a".repeat(64),
    // TEST_ONLY fixture: admission identity is ceremony-local, not DB-backed.
    scientificAdmissionVerified: true,
  });
  const evRange = decisionEvRangeFromRecord(economics);
  const whyNotCashJson = buildV2WhyNotCashJson({
    forecastId,
    packageContentDigestHex: "e".repeat(64),
    packageGenerationDigestHex: "f".repeat(64),
    evRange,
  });
  if (whyNotCashJson.includes("Active hypothesis conviction")) {
    throw new Error("forbidden V2 risk-over-cash rationale");
  }

  const risk = runRiskGateForFixture();
  const accountingSemanticDigest = runAccountingFixture({
    organizationId,
    runId: "control-replay-fixture-run",
    fillId: risk.fillId,
  });

  const parityDigest = computeControlReplayParityDigest({
    executionPurpose: "CONTROL_REPLAY",
    executionMode: "mock",
    authorityClass: "TEST_ONLY",
    capitalEligible: false,
    decisionActionable: evRange.decisionActionable,
    evLowerScale8: evRange.evLowerScale8,
    evBaseScale8: evRange.evBaseScale8,
    evUpperScale8: evRange.evUpperScale8,
    orderCount: risk.outcome === "APPROVE" ? 1 : 0,
    fillCount: risk.outcome === "APPROVE" ? 1 : 0,
    checkpointDigest: "checkpoint-fixture",
    semanticParityDigest: `${economics.contentDigest}:${accountingSemanticDigest}`,
  });

  return {
    parityDigest,
    decisionActionable: evRange.decisionActionable,
    riskOutcome: risk.outcome,
    accountingSemanticDigest,
    authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
  };
}

function expectEscapePrevented(
  surface: "production" | "FULL_HISTORICAL" | "shadow" | "live",
): void {
  try {
    assertControlReplayTestOnlyAuthorityV1({
      surface,
      authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
    });
    throw new Error(`expected TEST_ONLY rejection on ${surface}`);
  } catch (error) {
    if (!(error instanceof TestOnlyAuthorityRejectedError)) {
      throw error;
    }
  }
}

export function assertControlReplayTwoRunParityV1(): void {
  const runOne = runControlReplayRuntimeFixtureV1();
  const runTwo = runControlReplayRuntimeFixtureV1();
  assertControlReplayParityEqual(runOne.parityDigest, runTwo.parityDigest);
}
