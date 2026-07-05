import type { BarInterval, InstrumentId } from "@/lib/trader/intelligence/types";
import { MEAN_REVERSION_V0, MEAN_REVERSION_V0_VERSION } from "@/lib/trader/intelligence/types";
import type { ResearchPortfolioConfig } from "@/lib/trader/research/research-portfolio-config";
import { RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION } from "@/lib/trader/research/strategy-candidate.types";

export const M9_DEFAULT_VAULT_DIR = "replay-runs/RI-P7/m9-v2-research-campaign-org0";
export const M9_DEFAULT_DATASET_NAME = "m9-v2-research-campaign-org0";

export function parseM9Flags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eqIndex = body.indexOf("=");
    if (eqIndex === -1) {
      flags.set(body, "true");
    } else {
      flags.set(body.slice(0, eqIndex), body.slice(eqIndex + 1));
    }
  }
  return flags;
}

export function parseM9OosBarCount(flags: Map<string, string>): number {
  const raw = flags.get("oos-bar-count") ?? "20";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error("[m9] --oos-bar-count must be a positive integer");
  }
  return parsed;
}

export function parseM9MetricsSchemaVersion(flags: Map<string, string>): string {
  const version =
    flags.get("metrics-schema-version")?.trim() ?? RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  if (version !== RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION) {
    throw new Error(
      `[m9] --metrics-schema-version must be ${RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION}`,
    );
  }
  return version;
}

export function parseM9PortfolioConfig(flags: Map<string, string>): ResearchPortfolioConfig {
  const config: ResearchPortfolioConfig = {};
  const startingBalance =
    flags.get("starting-balance-usdt")?.trim() ?? process.env.M9_STARTING_BALANCE_USDT?.trim();
  if (startingBalance) {
    config.startingBalanceUsdt = startingBalance;
  }
  const maxRisk = flags.get("max-risk-per-trade-pct")?.trim();
  if (maxRisk) {
    config.maxRiskPerTradePct = maxRisk;
  }
  const maxPortfolioRisk = flags.get("max-portfolio-risk-pct")?.trim();
  if (maxPortfolioRisk) {
    config.maxPortfolioRiskPct = maxPortfolioRisk;
  }
  const maxConcurrent = flags.get("max-concurrent-positions")?.trim();
  if (maxConcurrent) {
    config.maxConcurrentPositions = Number.parseInt(maxConcurrent, 10);
  }
  const maxNotional = flags.get("max-notional")?.trim();
  if (maxNotional) {
    config.maxNotional = maxNotional;
  }
  const stopDistancePct = flags.get("default-stop-distance-pct")?.trim();
  if (stopDistancePct) {
    config.defaultStopDistancePct = stopDistancePct;
  }
  return config;
}

export function resolveM9CampaignStrategy(flags: Map<string, string>): {
  strategyId: string;
  strategyVersion: string;
} {
  return {
    strategyId: flags.get("strategy-id")?.trim() || MEAN_REVERSION_V0,
    strategyVersion: flags.get("strategy-version")?.trim() || MEAN_REVERSION_V0_VERSION,
  };
}

export function resolveM9SymbolInterval(flags: Map<string, string>): {
  symbol: InstrumentId;
  interval: BarInterval;
} {
  return {
    symbol: (flags.get("symbol")?.trim() || "BTC/USDT") as InstrumentId,
    interval: (flags.get("interval")?.trim() || "1m") as BarInterval,
  };
}

export function parseEnableGuardianExits(flags: Map<string, string>): boolean {
  return flags.get("enable-guardian-exits") === "1";
}
