import { RiskLimitsValidationError } from "@/lib/trader/risk/limits/errors";
import type { NormalizedRiskLimitsConfig } from "@/lib/trader/risk/limits/types";
import {
  compareDecimal,
  formatDecimal,
  isPositiveDecimal,
  parseDecimal,
} from "@/lib/trader/risk/numeric";

const SYMBOL_PATTERN = /^[A-Z0-9]+\/[A-Z0-9]+$/;

function canonicalizeDecimal(value: string): string {
  return formatDecimal(parseDecimal(value));
}

function normalizeAllowedSymbols(symbols: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const symbol of symbols) {
    const trimmed = symbol.trim().toUpperCase();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

function assertIntegerField(name: string, value: number, min: number, max?: number): number {
  if (!Number.isFinite(value)) {
    throw new RiskLimitsValidationError(`${name} must be a finite integer`);
  }
  const normalized = Math.trunc(value);
  if (normalized < min) {
    throw new RiskLimitsValidationError(`${name} must be >= ${min}`);
  }
  if (max !== undefined && normalized > max) {
    throw new RiskLimitsValidationError(`${name} must be <= ${max}`);
  }
  return normalized;
}

function assertPositiveDecimalField(name: string, value: string): string {
  if (!isPositiveDecimal(value)) {
    throw new RiskLimitsValidationError(`${name} must be a positive decimal string`);
  }
  return canonicalizeDecimal(value);
}

function assertPctDecimalField(name: string, value: string): string {
  if (!isPositiveDecimal(value)) {
    throw new RiskLimitsValidationError(`${name} must be a positive decimal string`);
  }
  const canonical = canonicalizeDecimal(value);
  if (compareDecimal(canonical, "1") > 0) {
    throw new RiskLimitsValidationError(`${name} must be <= 1`);
  }
  return canonical;
}

export function normalizeAndValidateRiskLimitsInput(input: {
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
}): NormalizedRiskLimitsConfig {
  const allowedSymbols = normalizeAllowedSymbols(input.allowedSymbols);

  for (const symbol of allowedSymbols) {
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new RiskLimitsValidationError(`invalid symbol format: ${symbol}`);
    }
  }

  return {
    allowedSymbols,
    maxNotional: assertPositiveDecimalField("maxNotional", input.maxNotional),
    maxOrdersPerWindow: assertIntegerField("maxOrdersPerWindow", input.maxOrdersPerWindow, 1),
    windowMs: assertIntegerField("windowMs", input.windowMs, 1000),
    collarBps: assertIntegerField("collarBps", input.collarBps, 0, 10_000),
    maxPositionPerSymbol: assertPositiveDecimalField(
      "maxPositionPerSymbol",
      input.maxPositionPerSymbol,
    ),
    maxDailyLoss: assertPositiveDecimalField("maxDailyLoss", input.maxDailyLoss),
    maxDrawdown: assertPositiveDecimalField("maxDrawdown", input.maxDrawdown),
    maxOpenOrders: assertIntegerField("maxOpenOrders", input.maxOpenOrders, 1),
    maxQuoteExposure: assertPositiveDecimalField("maxQuoteExposure", input.maxQuoteExposure),
    maxRiskPerTradePct: assertPctDecimalField("maxRiskPerTradePct", input.maxRiskPerTradePct),
    maxPortfolioRiskPct: assertPctDecimalField("maxPortfolioRiskPct", input.maxPortfolioRiskPct),
    maxConcurrentPositions: assertIntegerField(
      "maxConcurrentPositions",
      input.maxConcurrentPositions,
      1,
    ),
  };
}

const CONFIG_FIELD_NAMES = [
  "allowedSymbols",
  "maxNotional",
  "maxOrdersPerWindow",
  "windowMs",
  "collarBps",
  "maxPositionPerSymbol",
  "maxDailyLoss",
  "maxDrawdown",
  "maxOpenOrders",
  "maxQuoteExposure",
  "maxRiskPerTradePct",
  "maxPortfolioRiskPct",
  "maxConcurrentPositions",
] as const satisfies ReadonlyArray<keyof NormalizedRiskLimitsConfig>;

function allowedSymbolsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((symbol, index) => symbol === right[index]);
}

export function riskLimitsConfigEquals(
  left: NormalizedRiskLimitsConfig,
  right: NormalizedRiskLimitsConfig,
): boolean {
  if (!allowedSymbolsEqual(left.allowedSymbols, right.allowedSymbols)) {
    return false;
  }

  const decimalFields = [
    "maxNotional",
    "maxPositionPerSymbol",
    "maxDailyLoss",
    "maxDrawdown",
    "maxQuoteExposure",
    "maxRiskPerTradePct",
    "maxPortfolioRiskPct",
  ] as const;

  for (const field of decimalFields) {
    if (compareDecimal(left[field], right[field]) !== 0) {
      return false;
    }
  }

  const integerFields = [
    "maxOrdersPerWindow",
    "windowMs",
    "collarBps",
    "maxOpenOrders",
    "maxConcurrentPositions",
  ] as const;

  for (const field of integerFields) {
    if (left[field] !== right[field]) {
      return false;
    }
  }

  return true;
}

export function diffRiskLimitsConfig(
  previous: NormalizedRiskLimitsConfig,
  next: NormalizedRiskLimitsConfig,
): string[] {
  const changed: string[] = [];

  for (const field of CONFIG_FIELD_NAMES) {
    if (field === "allowedSymbols") {
      if (!allowedSymbolsEqual(previous.allowedSymbols, next.allowedSymbols)) {
        changed.push(field);
      }
      continue;
    }

    const decimalFields = new Set<keyof NormalizedRiskLimitsConfig>([
      "maxNotional",
      "maxPositionPerSymbol",
      "maxDailyLoss",
      "maxDrawdown",
      "maxQuoteExposure",
      "maxRiskPerTradePct",
      "maxPortfolioRiskPct",
    ]);

    if (decimalFields.has(field)) {
      const decimalField = field as
        | "maxNotional"
        | "maxPositionPerSymbol"
        | "maxDailyLoss"
        | "maxDrawdown"
        | "maxQuoteExposure";
      if (compareDecimal(previous[decimalField], next[decimalField]) !== 0) {
        changed.push(field);
      }
      continue;
    }

    if (previous[field] !== next[field]) {
      changed.push(field);
    }
  }

  return changed;
}
