import { parseOpeningCausalLineageV1 } from "./opening-causal-lineage-v1";
import type { TradeRow } from "./trade-lifecycle.types";

export type TenantTradeCausalLineageView = Readonly<{
  tradeId: string;
  symbol: string;
  state: TradeRow["state"];
  openingLineageDigest: string;
  forecastId: string;
  decisionId: string;
  riskVerdictId: string;
  riskAllowanceId: string;
}>;

export type AdminTradeCausalLineageView = TenantTradeCausalLineageView &
  Readonly<{
    organizationId: string;
    canonicalCausalLineageDigest: string;
    forecastContentDigest: string;
    decisionContentDigest: string;
    riskAllowanceContentDigest: string;
  }>;

function requiredLineage(trade: TradeRow) {
  if (!trade.openingCausalLineageJson || !trade.openingCausalLineageDigest) {
    throw new Error("TRADE_OPENING_CAUSAL_LINEAGE_UNAVAILABLE");
  }
  const lineage = parseOpeningCausalLineageV1(trade.openingCausalLineageJson);
  if (
    lineage.contentDigest !== trade.openingCausalLineageDigest ||
    lineage.organizationId !== trade.organizationId ||
    lineage.symbol !== trade.symbol
  ) {
    throw new Error("TRADE_OPENING_CAUSAL_LINEAGE_BINDING_MISMATCH");
  }
  return lineage;
}

export function buildTenantTradeCausalLineageView(
  organizationId: string,
  trade: TradeRow,
): TenantTradeCausalLineageView {
  if (trade.organizationId !== organizationId) {
    throw new Error("TENANT_CAUSAL_LINEAGE_SCOPE_MISMATCH");
  }
  const lineage = requiredLineage(trade);
  return Object.freeze({
    tradeId: trade.id,
    symbol: trade.symbol,
    state: trade.state,
    openingLineageDigest: lineage.contentDigest,
    forecastId: lineage.forecastId,
    decisionId: lineage.decisionId,
    riskVerdictId: lineage.riskVerdictId,
    riskAllowanceId: lineage.riskAllowanceId,
  });
}

export function buildAdminTradeCausalLineageView(trade: TradeRow): AdminTradeCausalLineageView {
  const lineage = requiredLineage(trade);
  return Object.freeze({
    ...buildTenantTradeCausalLineageView(trade.organizationId, trade),
    organizationId: trade.organizationId,
    canonicalCausalLineageDigest: lineage.canonicalCausalLineageDigest,
    forecastContentDigest: lineage.forecastContentDigest,
    decisionContentDigest: lineage.decisionContentDigest,
    riskAllowanceContentDigest: lineage.riskAllowanceContentDigest,
  });
}
