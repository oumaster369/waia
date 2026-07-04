import type { CapitalLimitsConfig } from "@/lib/trader/risk/capital-limits.types";
import type { TradeAbuseLimitsConfig } from "@/lib/trader/risk/trade-abuse.types";
import type { TraderAuditInput } from "@/lib/trader/types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type OrgRiskLimitsScope = {
  scopeType: "organization";
  scopeRef: null;
};

export type NormalizedRiskLimitsConfig = {
  allowedSymbols: readonly string[];
  maxNotional: string;
  maxOrdersPerWindow: number;
  windowMs: number;
  collarBps: number;
  maxPositionPerSymbol: string;
  maxDailyLoss: string;
  maxDrawdown: string;
  maxOpenOrders: number;
  maxQuoteExposure: string;
  maxRiskPerTradePct: string;
  maxPortfolioRiskPct: string;
  maxConcurrentPositions: number;
};

export type RiskLimitsRow = {
  id: string;
  organizationId: string;
  scopeType: "organization" | "venue" | "strategy";
  scopeRef: string;
  allowedSymbolsJson: string;
  maxNotional: string;
  maxOrdersPerWindow: number;
  windowMs: number;
  collarBps: number;
  maxPositionPerSymbol: string;
  maxDailyLoss: string;
  maxDrawdown: string;
  maxOpenOrders: number;
  maxQuoteExposure: string;
  maxRiskPerTradePct: string;
  maxPortfolioRiskPct: string;
  maxConcurrentPositions: number;
  configVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertRiskLimitsRowInput = NormalizedRiskLimitsConfig & {
  configVersion: number;
};

export type UpsertOrgRiskLimitsInput = {
  allowedSymbols: readonly string[];
  maxNotional: string;
  maxOrdersPerWindow: number;
  windowMs: number;
  collarBps: number;
  maxPositionPerSymbol: string;
  maxDailyLoss: string;
  maxDrawdown: string;
  maxOpenOrders: number;
  maxQuoteExposure: string;
  maxRiskPerTradePct: string;
  maxPortfolioRiskPct: string;
  maxConcurrentPositions: number;
  actorType?: TraderAuditInput["actorType"];
  actorId?: string | null;
  reason?: string;
};

export type OrgRiskLimitsMetadata = NormalizedRiskLimitsConfig & {
  id: string;
  scopeType: "organization" | "venue" | "strategy";
  scopeRef: string | null;
  configVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RiskLimitsRepository = {
  getLimitsRowForScope(
    context: OrgContext,
    scope: OrgRiskLimitsScope,
  ): RiskLimitsRow | null | Promise<RiskLimitsRow | null>;
  insertLimitsRowForScope(
    context: OrgContext,
    scope: OrgRiskLimitsScope,
    input: UpsertRiskLimitsRowInput,
  ): RiskLimitsRow | Promise<RiskLimitsRow>;
  updateLimitsRowForScope(
    context: OrgContext,
    scope: OrgRiskLimitsScope,
    rowId: string,
    input: UpsertRiskLimitsRowInput,
  ): RiskLimitsRow | null | Promise<RiskLimitsRow | null>;
};

export type RiskLimitsServiceDeps = {
  repository: RiskLimitsRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type RiskLimitsService = {
  getLimitsForOrg(context: OrgContext): Promise<OrgRiskLimitsMetadata | null>;
  getOrCreateLimitsForOrg(context: OrgContext): Promise<OrgRiskLimitsMetadata>;
  upsertLimitsForOrg(
    context: OrgContext,
    input: UpsertOrgRiskLimitsInput,
  ): Promise<OrgRiskLimitsMetadata>;
};

export type UpsertLimitsResult = {
  metadata: OrgRiskLimitsMetadata;
  created: boolean;
  updated: boolean;
};

export function scopeRefToDb(scope: OrgRiskLimitsScope): string {
  return scope.scopeRef ?? "";
}

export function scopeRefFromDb(scopeRef: string): string | null {
  return scopeRef === "" ? null : scopeRef;
}

export function parseAllowedSymbolsJson(raw: string): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((item): item is string => typeof item === "string");
}

export function rowToNormalizedConfig(row: RiskLimitsRow): NormalizedRiskLimitsConfig {
  return {
    allowedSymbols: parseAllowedSymbolsJson(row.allowedSymbolsJson),
    maxNotional: row.maxNotional,
    maxOrdersPerWindow: row.maxOrdersPerWindow,
    windowMs: row.windowMs,
    collarBps: row.collarBps,
    maxPositionPerSymbol: row.maxPositionPerSymbol,
    maxDailyLoss: row.maxDailyLoss,
    maxDrawdown: row.maxDrawdown,
    maxOpenOrders: row.maxOpenOrders,
    maxQuoteExposure: row.maxQuoteExposure,
    maxRiskPerTradePct: row.maxRiskPerTradePct,
    maxPortfolioRiskPct: row.maxPortfolioRiskPct,
    maxConcurrentPositions: row.maxConcurrentPositions,
  };
}

export function toOrgRiskLimitsMetadata(row: RiskLimitsRow): OrgRiskLimitsMetadata {
  const config = rowToNormalizedConfig(row);
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeRef: scopeRefFromDb(row.scopeRef),
    configVersion: row.configVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...config,
  };
}

export function toTradeAbuseLimitsConfig(
  metadata: OrgRiskLimitsMetadata | NormalizedRiskLimitsConfig,
): TradeAbuseLimitsConfig {
  return {
    allowedSymbols: metadata.allowedSymbols,
    maxNotional: metadata.maxNotional,
    maxOrdersPerWindow: metadata.maxOrdersPerWindow,
    windowMs: metadata.windowMs,
    collarBps: metadata.collarBps,
  };
}

export function toCapitalLimitsConfig(
  metadata: OrgRiskLimitsMetadata | NormalizedRiskLimitsConfig,
): CapitalLimitsConfig {
  return {
    maxPositionPerSymbol: metadata.maxPositionPerSymbol,
    maxDailyLoss: metadata.maxDailyLoss,
    maxDrawdown: metadata.maxDrawdown,
    maxOpenOrders: metadata.maxOpenOrders,
    maxQuoteExposure: metadata.maxQuoteExposure,
    maxRiskPerTradePct: metadata.maxRiskPerTradePct,
    maxPortfolioRiskPct: metadata.maxPortfolioRiskPct,
    maxConcurrentPositions: metadata.maxConcurrentPositions,
  };
}

export function normalizedConfigToRowInput(
  config: NormalizedRiskLimitsConfig,
  configVersion: number,
): UpsertRiskLimitsRowInput {
  return {
    ...config,
    configVersion,
  };
}
