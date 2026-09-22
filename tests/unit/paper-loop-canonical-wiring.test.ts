import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/runtime-v2/canonical-recurring-cycle-v2", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/trader/runtime-v2/canonical-recurring-cycle-v2")>();
  return {
    ...actual,
    runCanonicalOrdinaryCapitalCycleV2: vi.fn(actual.runCanonicalOrdinaryCapitalCycleV2),
  };
});

import * as evaluationCycleModule from "@/lib/trader/intelligence/evaluation-cycle";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { EvaluationCycleResult } from "@/lib/trader/intelligence/types";
import type { BarPollSource, MarketSnapshot } from "@/lib/trader/market-data/types";
import { runPaperBarCloseLoop } from "@/lib/trader/paper/paper-bar-close-loop";
import {
  createJsonlPaperSignalLedger,
  createMemoryPaperSignalLedger,
  encodePaperSignalSseEvent,
} from "@/lib/trader/paper/paper-signal-ledger";
import {
  buildPreQualificationPaperEnvelope,
  PRE_QUALIFICATION_UNAVAILABLE_SOURCES,
} from "@/lib/trader/paper/pre-qualification-paper-envelope";
import { runCanonicalOrdinaryCapitalCycleV2 } from "@/lib/trader/runtime-v2/canonical-recurring-cycle-v2";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import {
  renderPaperLoopSystemdUnit,
  verifyPaperLoopSystemdUnit,
} from "@/lib/trader/observability/paper-loop-systemd-unit-renderer";
import type { AccountRiskState } from "@/lib/trader/risk/capital-limits.types";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";

const ORG = "00000000-0000-4000-8000-0000000260";
const PIT = "2026-01-01T00:01:00.000Z";

const EMPTY_STATE: AccountRiskState = {
  positions: [],
  openOrderCount: 0,
  dailyPnl: "0",
  drawdown: "0",
  quoteExposureByCurrency: {},
};

function evaluation(): EvaluationCycleResult {
  const signal = {
    strategySignalId: "signal-paper-1",
    strategyId: "mean_reversion_v0" as const,
    strategyVersion: "0.1.0",
    organizationId: ORG,
    symbol: "BTC/USDT",
    outcome: "SIGNAL" as const,
    side: "buy" as const,
    confidence: "0.8",
    expectedEdge: "0.01",
    horizon: "1h" as const,
    maxRisk: "100",
    reasonCodes: ["STRAT_MR_ZSCORE_BUY"],
    msvId: "msv-1",
    featureSetId: "features-1",
    evaluatedAt: PIT,
  };
  return {
    features: {
      featureSetId: "features-1",
      instrumentId: "BTC/USDT",
      evaluatedAt: PIT,
      features: { close: "64000" },
      dataQualityScore: 1,
      inputs: { barCount: 1 },
    },
    msv: {
      msvId: "msv-1",
      instrumentId: "BTC/USDT",
      evaluatedAt: PIT,
      featureSetId: "features-1",
      physics: {},
      liquidity: {},
      crowd: {},
      futureContext: {},
      derived: {
        regime: "TREND_BEAR",
        tradingPermission: "ALLOW_TRADING",
        allowedStrategyIds: ["mean_reversion_v0"],
        riskMultiplier: "1",
        dataQualityScore: 1,
        reasonCodes: [],
      },
    },
    signal,
    signals: [signal],
    forecastRuntimeOutcome: {
      schemaVersion: "waia.trader.forecast_runtime_non_actionable.v2",
      status: "NON_ACTIONABLE",
      capitalAuthority: "NONE",
      reason: "MISSING_OR_NOT_ADMITTED",
      predictiveAdmissionReceiptContentDigestHex: null,
      marketStateSnapshotContentDigestHex: null,
      selectedPredictivePackageContentDigestHex: null,
      upstreamReasonCodes: [],
      contentDigestHex: "a".repeat(64),
    },
  } as unknown as EvaluationCycleResult;
}

function snapshot(): MarketSnapshot {
  return {
    bars: [
      {
        symbol: "BTC/USDT",
        interval: "1m",
        open: "64000",
        high: "64000",
        low: "64000",
        close: "64000",
        volume: "1",
        barOpenTime: "2026-01-01T00:00:00.000Z",
        barCloseTime: PIT,
      },
    ],
    quote: { symbol: "BTC/USDT", bid: "64000", ask: "64000", last: "64000", timestamp: PIT },
    evaluatedAt: PIT,
    cycleIndex: 0,
    cycleId: "cycle-paper-1",
  };
}

function deps(): PaperCycleDeps {
  return {
    execution: { submitOrder: vi.fn() },
    reconciliation: { reconcile: vi.fn() },
    decisionCapitalAuthorityV2: {
      decide: vi.fn(async () => {
        throw new Error("DECIDE_NOT_REACHED");
      }),
      assessRisk: vi.fn(async () => {
        throw new Error("RISK_NOT_REACHED");
      }),
      execute: vi.fn(async () => {
        throw new Error("EXECUTE_NOT_REACHED");
      }),
    },
    canonicalOrdinaryCapitalEnvelopeV2: buildPreQualificationPaperEnvelope(),
  };
}

describe("paper loop canonical wiring", () => {
  beforeEach(() => {
    vi.spyOn(evaluationCycleModule, "runEvaluationCycle").mockReturnValue(evaluation());
  });

  it("reaches the canonical cycle in paper mode and records the signal", async () => {
    const ledger = createMemoryPaperSignalLedger();
    const cycleDeps = deps();
    const poll: BarPollSource = {
      fetchSnapshot: async () => snapshot(),
      reset() {},
    };
    const result = await runPaperBarCloseLoop({
      poll,
      deps: cycleDeps,
      context: requireOrgContext(ORG),
      accountKey: "acct-paper",
      defaultQuantity: "0.01",
      accountState: EMPTY_STATE,
      executionMode: "paper",
      canonicalOrdinaryCapitalEnvelopeV2: buildPreQualificationPaperEnvelope(),
      signalLedger: ledger,
      informationSufficiencyAuthority: declareResearchNonCapitalInformationAuthorityV2({
        organizationId: ORG,
        reason: "TRADER_PAPER_LOOP_CANONICAL_WIRING_TEST",
      }),
      maxCycles: 1,
      syntheticNowMs: { current: 0 },
      sleep: async () => {},
    });
    expect(result.cyclesRun).toBe(1);
    const envelope = buildPreQualificationPaperEnvelope();
    expect(envelope.predictiveAdmissionVerdict).toBe("NOT_ADMITTED");
    expect(envelope.context).toBeUndefined();
    expect(envelope.contextInputs).toBeUndefined();
    expect(JSON.stringify(envelope)).not.toContain("0".repeat(64));
    expect(runCanonicalOrdinaryCapitalCycleV2).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runCanonicalOrdinaryCapitalCycleV2).mock.calls[0]?.[0]).toMatchObject({
      epistemic: {
        kind: "CONTEXT_UNAVAILABLE",
        sources: PRE_QUALIFICATION_UNAVAILABLE_SOURCES,
      },
      capitalRequest: { executionMode: "paper" },
    });
    const records = await ledger.list();
    expect(records).toHaveLength(1);
    expect(records[0]?.strategySignalId).toBe("signal-paper-1");
    expect(records[0]?.riskVerdict).toBe("NO_TRADE");
    expect(records[0]?.reasonCodes).toEqual(
      PRE_QUALIFICATION_UNAVAILABLE_SOURCES.map((source) => `UNAVAILABLE:${source}`),
    );
    expect(cycleDeps.execution.submitOrder).not.toHaveBeenCalled();
    expect(cycleDeps.decisionCapitalAuthorityV2?.decide).not.toHaveBeenCalled();
  });

  it("appends signal records to a jsonl file", async () => {
    const filePath = path.join(mkdtempSync(path.join(tmpdir(), "paper-ledger-")), "signals.jsonl");
    const ledger = createJsonlPaperSignalLedger(filePath);
    await ledger.append({
      cycleId: "cycle-1",
      strategySignalId: "signal-1",
      riskVerdict: "NO_TRADE",
      reasonCodes: ["PREDICTIVE_ADMISSION_NOT_ADMITTED"],
    });
    expect(await ledger.list()).toEqual([
      {
        cycleId: "cycle-1",
        strategySignalId: "signal-1",
        riskVerdict: "NO_TRADE",
        reasonCodes: ["PREDICTIVE_ADMISSION_NOT_ADMITTED"],
      },
    ]);
  });

  it("encodes a paper signal as an SSE frame", () => {
    const frame = encodePaperSignalSseEvent({
      cycleId: "cycle-1",
      strategySignalId: "signal-1",
      riskVerdict: "NO_TRADE",
      reasonCodes: ["PREDICTIVE_ADMISSION_NOT_ADMITTED"],
    });
    expect(frame.startsWith("event: paper_signal\ndata: ")).toBe(true);
    expect(frame.endsWith("\n\n")).toBe(true);
  });

  it("renders a paper-loop systemd unit without a fixture or a secret", () => {
    const unit = renderPaperLoopSystemdUnit({
      schemaVersion: "paper-loop-systemd-unit-config/v1",
      workingDirectory: "/opt/waia",
      serviceUser: "waia",
      environmentFile: "/etc/waia/paper-loop.env",
      nodeBin: "/usr/bin/node",
      organizationId: "00000000-0000-4000-8000-000000000260",
      accountKey: "acct-paper",
    });
    verifyPaperLoopSystemdUnit(unit);
    expect(unit).toContain("mock venue");
    expect(unit).not.toContain("--fixture-path");
  });
});
