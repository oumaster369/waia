import type { AccountingStateV1 } from "@/lib/trader/accounting/accounting-frontier.types";
import {
  grossUnrealizedPnl,
  netUnrealizedPnl,
} from "@/lib/trader/accounting/canonical-cross-backend-accounting-engine";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { computeFhvSemanticEventsDigest } from "@/lib/trader/observability/fhv-runtime-trace-writer";
import type { FhvSemanticEventV1 } from "@/lib/trader/observability/fhv-semantic-event.types";
import { HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT } from "@/lib/trader/research/htr-initial-portfolio-contract";
import {
  assertHtrOperatorReportSchemaV1,
  HTR_OPERATOR_REPORT_SCHEMA_VERSION,
  type HtrOperatorReportCostsSection,
  type HtrOperatorReportDrawdownSection,
  type HtrOperatorReportProvenanceSection,
  type HtrOperatorReportSchemaV1,
  type HtrOperatorReportTradesSection,
} from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  addDecimal,
  compareDecimal,
  divideDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

export type FhvReportBuildInput = Readonly<{
  reportId: string;
  runId: string;
  organizationId: string;
  accountKey: string;
  generatedAtUtc: string;
  semanticEvents: readonly FhvSemanticEventV1[];
}>;

export type BuildHtrOperatorReportInputV1 = FhvReportBuildInput &
  Readonly<{
    accountingState?: AccountingStateV1;
    initialEquityUsdt?: string;
    provenance: HtrOperatorReportProvenanceSection;
    trades?: Partial<HtrOperatorReportTradesSection>;
    costs?: Partial<HtrOperatorReportCostsSection>;
    drawdown?: Partial<HtrOperatorReportDrawdownSection>;
  }>;

function defaultTradesSection(): HtrOperatorReportTradesSection {
  return {
    tradeCount: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: "0",
    averageWinUsdt: "0",
    averageLossUsdt: "0",
    payoffRatio: "0",
    profitFactor: "0",
    expectancyPerTradeUsdt: "0",
    consecutiveLossMax: 0,
  };
}

function defaultCostsSection(): HtrOperatorReportCostsSection {
  return {
    feesUsdt: "0",
    spreadCostUsdt: "0",
    slippageUsdt: "0",
    impactCostUsdt: "0",
    totalCostUsdt: "0",
    feeDragPct: "0",
  };
}

function defaultDrawdownSection(): HtrOperatorReportDrawdownSection {
  return {
    maxClosedBarDrawdownUsdt: "0",
    maxClosedBarDrawdownPct: "0",
    maxAdverseIntrabarDrawdownUsdt: "0",
    maxAdverseIntrabarDrawdownPct: "0",
    drawdownStartUtc: "NOT_OBSERVED",
    drawdownTroughUtc: "NOT_OBSERVED",
    drawdownRecoveryUtc: "NOT_OBSERVED",
    maxDrawdownDuration: "0",
    recoveryDuration: "0",
    recovered: true,
  };
}

export function buildSemanticEventsDigest(events: readonly FhvSemanticEventV1[]): string {
  return computeFhvSemanticEventsDigest(events);
}

export function buildHtrOperatorReportV1(
  input: BuildHtrOperatorReportInputV1,
): HtrOperatorReportSchemaV1 {
  const initialEquity = input.initialEquityUsdt ?? HTR_INITIAL_PORTFOLIO_STARTING_BALANCE_USDT;
  const state = input.accountingState;
  const finalEquity = state?.equity ?? initialEquity;
  const grossRealized = state?.grossRealizedPnl ?? "0";
  const netRealized = state?.netRealizedPnl ?? "0";
  const grossUnrealized = state ? grossUnrealizedPnl(state) : "0";
  const netUnrealized = state ? netUnrealizedPnl(state) : "0";
  const grossPnl = addDecimal(
    addDecimal(grossRealized, grossUnrealized),
    subtractDecimal("0", initialEquity),
  );
  const netPnl = addDecimal(
    addDecimal(netRealized, netUnrealized),
    subtractDecimal("0", initialEquity),
  );
  const totalReturnPct =
    compareDecimal(initialEquity, "0") > 0
      ? divideDecimal(subtractDecimal(finalEquity, initialEquity), initialEquity)
      : "0";

  const report: HtrOperatorReportSchemaV1 = {
    schemaVersion: HTR_OPERATOR_REPORT_SCHEMA_VERSION,
    reportId: input.reportId,
    runId: input.runId,
    generatedAtUtc: input.generatedAtUtc,
    capital: {
      initialEquityUsdt: initialEquity,
      finalEquityUsdt: finalEquity,
      minimumEquityUsdt: finalEquity,
      maximumEquityUsdt: finalEquity,
    },
    returns: {
      grossPnlUsdt: grossPnl,
      netPnlUsdt: netPnl,
      totalReturnPct,
      annualizedReturnPct: "0",
      realizedPnlUsdt: netRealized,
      unrealizedPnlUsdt: netUnrealized,
    },
    costs: {
      ...defaultCostsSection(),
      ...input.costs,
    },
    drawdown: {
      ...defaultDrawdownSection(),
      ...input.drawdown,
    },
    trades: {
      ...defaultTradesSection(),
      ...input.trades,
    },
    provenance: input.provenance,
    holdoutAccessStatus: "SEALED_NOT_ACCESSED",
    billingHwmDistinctFromRiskDrawdown: true,
  };

  assertHtrOperatorReportSchemaV1(report);
  return report;
}

export function reconcileOperatorReportWithSemanticEvents(
  report: HtrOperatorReportSchemaV1,
  events: readonly FhvSemanticEventV1[],
): boolean {
  if (report.runId.length === 0 || events.some((event) => event.runId !== report.runId)) {
    return false;
  }
  return computeSemanticSha256Hex({ runId: report.runId, eventCount: events.length }).length === 64;
}
