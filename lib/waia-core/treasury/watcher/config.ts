import { USDT_TRC20_CONTRACT } from "@/lib/waia-core/payment-watcher/watcher-config";
import { TREASURY_USDT_V1_ASSET, TREASURY_USDT_V1_NETWORK } from "@/lib/waia-core/treasury/types";

export const TREASURY_WATCHER_CHECKPOINT_KEY = "TRC-20:treasury" as const;
export const TREASURY_WATCHER_INGESTION_SOURCE = "treasury-watcher" as const;

export type TreasuryWatcherConfig = {
  enabled: boolean;
  network: typeof TREASURY_USDT_V1_NETWORK;
  assetCode: typeof TREASURY_USDT_V1_ASSET;
  nativeDecimals: 6;
  tokenContract: string;
  confirmationsRequired: number;
  rescanWindow: number;
  maxBlocksPerCycle: number;
  leaseTtlSeconds: number;
  staleThresholdSeconds: number;
  rpcMaxRetries: number;
  reorgAgeoutMinutes: number;
  maxPagesPerBlock: number;
  tronPrimaryUrl: string;
  tronSecondaryUrl: string;
  tronGridApiKey: string;
  tronSecondaryApiKey: string;
};

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function readEnv(env: Record<string, unknown>, key: string): string | undefined {
  const value = env[key];
  if (typeof value === "string") {
    return value;
  }
  if (value === undefined || value === null) {
    return process.env[key];
  }
  return String(value);
}

/** Parse Treasury watcher config. Independent of payment `WATCHER_ENABLED`. Default DARK. */
export function loadTreasuryWatcherConfig(
  env: Record<string, unknown> = process.env,
): TreasuryWatcherConfig {
  return {
    enabled: parseBool(readEnv(env, "TREASURY_WATCHER_ENABLED"), false),
    network: TREASURY_USDT_V1_NETWORK,
    assetCode: TREASURY_USDT_V1_ASSET,
    nativeDecimals: 6,
    tokenContract: readEnv(env, "TREASURY_WATCHER_USDT_CONTRACT")?.trim() || USDT_TRC20_CONTRACT,
    confirmationsRequired: parsePositiveInt(
      readEnv(env, "TREASURY_WATCHER_CONFIRMATIONS_REQUIRED"),
      20,
    ),
    rescanWindow: parsePositiveInt(readEnv(env, "TREASURY_WATCHER_RESCAN_WINDOW"), 40),
    maxBlocksPerCycle: parsePositiveInt(readEnv(env, "TREASURY_WATCHER_MAX_BLOCKS_PER_CYCLE"), 50),
    leaseTtlSeconds: parsePositiveInt(readEnv(env, "TREASURY_WATCHER_LEASE_TTL_SECONDS"), 600),
    staleThresholdSeconds: parsePositiveInt(
      readEnv(env, "TREASURY_WATCHER_STALE_THRESHOLD_SECONDS"),
      300,
    ),
    rpcMaxRetries: parsePositiveInt(readEnv(env, "TREASURY_WATCHER_RPC_MAX_RETRIES"), 3),
    reorgAgeoutMinutes: parsePositiveInt(readEnv(env, "TREASURY_WATCHER_REORG_AGEOUT_MINUTES"), 30),
    maxPagesPerBlock: parsePositiveInt(readEnv(env, "TREASURY_WATCHER_MAX_PAGES_PER_BLOCK"), 50),
    tronPrimaryUrl:
      readEnv(env, "TREASURY_WATCHER_TRON_PRIMARY_URL")?.trim() || "https://api.trongrid.io",
    tronSecondaryUrl: readEnv(env, "TREASURY_WATCHER_TRON_SECONDARY_URL")?.trim() || "",
    tronGridApiKey: readEnv(env, "TREASURY_WATCHER_TRONGRID_API_KEY")?.trim() || "",
    tronSecondaryApiKey: readEnv(env, "TREASURY_WATCHER_TRON_SECONDARY_API_KEY")?.trim() || "",
  };
}
