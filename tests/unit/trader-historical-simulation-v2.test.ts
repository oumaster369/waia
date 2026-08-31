import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2", async (load) => {
  const actual = await load<
    typeof import("@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2")
  >();
  return {
    ...actual,
    issueForecastRuntimeV2: vi.fn((input: { knowledgeContentDigestHex?: string }) => ({
      status: "FORECAST_AUTHORIZED" as const,
      authority: {
        organizationId: "11111111-1111-4111-8111-111111111111",
        contentDigestHex: input.knowledgeContentDigestHex ?? "a".repeat(64),
      },
      issuance: { package: { family: { symbol: "BTCUSDT" } } },
    })),
    requireForecastRuntimeAuthorizedOutcomeV2: vi.fn((value) => value),
  };
});

import {
  runHistoricalSimulationV2,
  type HistoricalKnowledgePortV2,
} from "@/lib/trader/backtest/historical-simulation-v2";
import type {
  CanonicalDecisionCapitalAuthorityV2Deps,
  DecisionAuthorityV2,
} from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import type { ForecastRuntimeInputV2 } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";

const ORG = "11111111-1111-4111-8111-111111111111";
const digest = (character: string) => character.repeat(64);
const times = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:01:00.000Z",
  "2026-01-01T00:02:00.000Z",
];

function cycles() {
  return times.map((observedAt, index) => ({
    cycleId: `cycle-${index}`,
    observedAt,
    symbol: "BTCUSDT",
    referencePrice: "50000",
  }));
}

function knowledge(): HistoricalKnowledgePortV2 {
  let state = digest("1");
  return {
    snapshotAsOf: vi.fn(async (asOf) => ({ asOf, contentDigestHex: state })),
    closeMaturedForecasts: vi.fn(async (strictlyBefore) =>
      strictlyBefore === times[2]
        ? [
            {
              forecastAuthorityContentDigestHex: digest("a"),
              maturedAt: times[1],
              outcomeContentDigestHex: digest("2"),
            },
          ]
        : [],
    ),
    applyMaturedClosures: vi.fn(async ({ strictlyBefore, closures }) => {
      if (closures.length > 0) state = digest("3");
      return { asOf: strictlyBefore, contentDigestHex: state };
    }),
  };
}

function decision(index: number): DecisionAuthorityV2 {
  return {
    decisionId: `decision-${index}`,
    semanticDigestHex: digest("b"),
    contentDigestHex: digest("c"),
    forecastAuthorityContentDigestHex: index === 2 ? digest("3") : digest("1"),
    action: "ENTER_LONG",
    evLower: "1",
    evBase: "2",
    evUpper: "3",
    economicSizeSetId: "size-set",
    economicSizeSetDigestHex: digest("d"),
    qualifiedQuantity: "0.01",
  };
}

function authority(): CanonicalDecisionCapitalAuthorityV2Deps {
  return {
    decide: vi.fn(async (request) => {
      const current = request.cycleId === "cycle-2" ? 2 : 0;
      return { status: "ACTIONABLE" as const, decision: decision(current) };
    }),
    assessRisk: vi.fn(async ({ decision: value }) =>
      value.decisionId === "decision-2"
        ? {
            status: "VETO" as const,
            decisionContentDigestHex: value.contentDigestHex,
            reasonCodes: ["RISK_MAX_DRAWDOWN"],
          }
        : {
            status: "PERMITTED" as const,
            decisionContentDigestHex: value.contentDigestHex,
            riskVerdictId: "verdict-0",
            riskVerdictContentDigestHex: digest("e"),
            riskAllowanceId: "allowance-0",
            riskAllowanceContentDigestHex: digest("f"),
            approvedQualifiedQuantity: "0.005",
          },
    ),
    execute: vi.fn(async ({ decision: value, permission }) => ({
      decisionContentDigestHex: value.contentDigestHex,
      riskAllowanceId: permission.riskAllowanceId,
      riskAllowanceContentDigestHex: permission.riskAllowanceContentDigestHex,
      riskAllowanceOrderBindingDigestHex: digest("7"),
      executionPlanId: "plan-0",
      executionPlanContentDigestHex: digest("8"),
      executionAttemptId: "attempt-0",
      executionAttemptContentDigestHex: digest("9"),
      submittedQuantity: "0.005",
      execution: {
        status: "submitted" as const,
        order: {
          id: "order-0",
          organizationId: ORG,
          credentialId: null,
          venue: "historical-modeled",
          executionMode: "mock" as const,
          symbol: "BTCUSDT",
          side: "buy" as const,
          type: "market" as const,
          price: null,
          quantity: "0.005",
          filledQuantity: "0",
          avgFillPrice: null,
          state: "SENT_TO_EXCHANGE" as const,
          stateVersion: 1,
          exchangeOrderId: null,
          clientOrderId: "modeled-0",
          idempotencyKey: "modeled-0",
          riskDecisionId: permission.riskVerdictId,
          riskAllowanceId: permission.riskAllowanceId,
          riskAllowanceBindingDigest: digest("7"),
          strategySignalId: null,
          allocationDecisionId: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        },
      },
    })),
  };
}

const emptyForecast = (knowledgeDigest: string) =>
  ({ knowledgeContentDigestHex: knowledgeDigest }) as ForecastRuntimeInputV2;

function proposal(index: number) {
  return {
    decisionSemanticMode: "HISTORICAL" as const,
    action: index === 1 ? ("CASH" as const) : ("ENTER_LONG" as const),
    quantity: index === 1 ? null : "0.01",
    proposalContentDigestHex: digest("5"),
    reasonCodes: index === 1 ? ["EV_LOWER_NON_POSITIVE"] : [],
    decisionContentDigestHex: index === 1 ? digest("4") : digest("c"),
    whyNotCashReceiptDigestHex: digest("6"),
    evLower: index === 1 ? "-1" : "1",
    evBase: index === 1 ? "-0.5" : "2",
    evUpper: index === 1 ? "0" : "3",
  };
}

const ledgerProjection = async () => ({
  accounting: { status: "UNCHANGED" as const, reasonCodes: [], frontierContentDigestHex: digest("7") },
  guardian: { status: "NONE" as const, reasonCodes: [], assessmentContentDigestHex: digest("8") },
  learning: {
    status: "NO_UPDATE" as const,
    reasonCodes: ["NO_MATURED_UPDATE_FOR_CURRENT_ISSUANCE"],
    calibrationObservationContentDigestHex: null,
    knowledgeUpdateContentDigestHex: null,
    eligibleResolutionAtUtc: null,
    visibleFromPitAnchorUtc: null,
  },
});

describe("Historical Simulation V2 composition boundary", () => {
  it("emits ENTER_LONG, economic CASH and risk-veto CASH with future-only learning", async () => {
    const knowledgePort = knowledge();
    const stages = authority();
    const result = await runHistoricalSimulationV2({
      organizationId: ORG,
      accountId: "historical-account",
      runId: "run-1",
      split: "walk_forward",
      authority: "HISTORICAL_SIMULATION_V2",
      cycles: cycles(),
      defaultQuantity: "0.01",
      knowledge: knowledgePort,
      resolveForecastInput: vi.fn(async ({ knowledge: snapshot }) =>
        emptyForecast(snapshot.contentDigestHex),
      ),
      decisionCapitalAuthorityV2: stages,
      resolvePortfolioProposal: vi.fn(async ({ cycle }) => proposal(Number(cycle.cycleId.at(-1)))),
      resolveLedgerProjection: ledgerProjection,
      postgresSchemaPreflight: vi.fn(async () => undefined),
    });

    expect(result).toMatchObject({ cycleCount: 3, enterLongCount: 1, cashCount: 2 });
    expect(result.evidence.map((row) => [row.action, row.terminalStage])).toEqual([
      ["ENTER_LONG", "EXECUTION"],
      ["CASH", "DECISION"],
      ["CASH", "RISK"],
    ]);
    expect(result.evidence[0]?.knowledgeAfterClosureDigestHex).toBe(digest("1"));
    expect(result.evidence[1]?.knowledgeAfterClosureDigestHex).toBe(digest("1"));
    expect(result.evidence[2]?.knowledgeAfterClosureDigestHex).toBe(digest("3"));
    expect(result.evidence[2]?.maturedClosureDigestsHex).toEqual([digest("2")]);
    expect(stages.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects blind holdout and any same-cycle/future outcome closure", async () => {
    const base = {
      organizationId: ORG,
      accountId: "historical-account",
      runId: "run-1",
      authority: "HISTORICAL_SIMULATION_V2" as const,
      cycles: cycles().slice(0, 1),
      defaultQuantity: "0.01",
      knowledge: knowledge(),
      resolveForecastInput: vi.fn(async () => emptyForecast(digest("1"))),
      decisionCapitalAuthorityV2: authority(),
      resolvePortfolioProposal: vi.fn(async () => proposal(0)),
      resolveLedgerProjection: ledgerProjection,
      postgresSchemaPreflight: vi.fn(async () => undefined),
    };
    await expect(
      runHistoricalSimulationV2({ ...base, split: "blind" } as never),
    ).rejects.toThrow("HISTORICAL_SIMULATION_V2_FORBIDDEN:blindHoldout");

    const leaking: HistoricalKnowledgePortV2 = {
      snapshotAsOf: async (asOf) => ({ asOf, contentDigestHex: digest("1") }),
      closeMaturedForecasts: async () => [
        {
          forecastAuthorityContentDigestHex: digest("a"),
          maturedAt: times[0]!,
          outcomeContentDigestHex: digest("2"),
        },
      ],
      applyMaturedClosures: async ({ strictlyBefore }) => ({
        asOf: strictlyBefore,
        contentDigestHex: digest("3"),
      }),
    };
    await expect(
      runHistoricalSimulationV2({ ...base, split: "development", knowledge: leaking }),
    ).rejects.toThrow("HISTORICAL_SIMULATION_V2_PIT_VIOLATION:futureClosure");
  });

  it("routes CLOSE through the isolated modeled exit port and preserves its evidence", async () => {
    const closeProposal = {
      ...proposal(0),
      action: "CLOSE" as const,
      quantity: "0.005",
      reasonCodes: ["GUARDIAN_CLOSE"],
    };
    const modeledExit = {
      execute: vi.fn(async () => ({
        risk: {
          status: "APPROVE" as const,
          reasonCodes: [],
          verdictContentDigestHex: digest("a"),
          allowanceContentDigestHex: digest("b"),
        },
        execution: {
          status: "NO_FILL" as const,
          reasonCodes: ["MODELED_LIMIT_NOT_REACHED"],
          planContentDigestHex: digest("d"),
          attemptContentDigestHex: digest("e"),
          reportContentDigestHex: digest("f"),
          fillContentDigestHexes: [],
        },
      })),
    };
    const result = await runHistoricalSimulationV2({
      organizationId: ORG,
      accountId: "historical-account",
      runId: "run-close",
      split: "development",
      authority: "HISTORICAL_SIMULATION_V2",
      cycles: cycles().slice(0, 1),
      defaultQuantity: "0.01",
      knowledge: knowledge(),
      resolveForecastInput: async () => emptyForecast(digest("1")),
      decisionCapitalAuthorityV2: authority(),
      resolvePortfolioProposal: async () => closeProposal,
      modeledExit,
      resolveLedgerProjection: ledgerProjection,
      postgresSchemaPreflight: async () => undefined,
    });
    expect(result).toMatchObject({ closeCount: 1, enterLongCount: 0, cashCount: 0 });
    expect(result.evidence[0]).toMatchObject({
      action: "CLOSE",
      riskVerdictContentDigestHex: digest("a"),
      executionPlanContentDigestHex: digest("d"),
      reasonCodes: ["MODELED_LIMIT_NOT_REACHED"],
    });
    expect(modeledExit.execute).toHaveBeenCalledTimes(1);
  });
});
