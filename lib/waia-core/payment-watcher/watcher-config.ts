/** Canonical USDT TRC-20 mainnet contract (ADR-0015). */
export const USDT_TRC20_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export const USDT_DECIMALS = 6;

/** Registry + settlement network identifier (ADR-0015 decision 6). */
export const CANONICAL_NETWORK = "TRC-20" as const;

export type WatcherConfig = {
  network: typeof CANONICAL_NETWORK;
  enabled: boolean;
  confirmationsRequired: number;
  rescanWindow: number;
  maxBlocksPerCycle: number;
  leaseTtlSeconds: number;
  startBlock: string;
  staleThresholdSeconds: number;
  rpcMaxRetries: number;
  reorgAgeoutMinutes: number;
  confirmQuorum: boolean;
  tronContractAddress: string;
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

/** Parse watcher configuration from Worker env or process.env (per-network defaults). */
export function loadWatcherConfig(env: Record<string, unknown> = process.env): WatcherConfig {
  return {
    network: CANONICAL_NETWORK,
    enabled: parseBool(readEnv(env, "WATCHER_ENABLED"), false),
    confirmationsRequired: parsePositiveInt(readEnv(env, "WATCHER_CONFIRMATIONS_REQUIRED"), 20),
    rescanWindow: parsePositiveInt(readEnv(env, "WATCHER_RESCAN_WINDOW"), 40),
    maxBlocksPerCycle: parsePositiveInt(readEnv(env, "WATCHER_MAX_BLOCKS_PER_CYCLE"), 200),
    leaseTtlSeconds: parsePositiveInt(readEnv(env, "WATCHER_LEASE_TTL_SECONDS"), 600),
    startBlock: readEnv(env, "WATCHER_START_BLOCK")?.trim() || "0",
    staleThresholdSeconds: parsePositiveInt(readEnv(env, "WATCHER_STALE_THRESHOLD_SECONDS"), 300),
    rpcMaxRetries: parsePositiveInt(readEnv(env, "WATCHER_RPC_MAX_RETRIES"), 3),
    reorgAgeoutMinutes: parsePositiveInt(readEnv(env, "WATCHER_REORG_AGEOUT_MINUTES"), 30),
    confirmQuorum: parseBool(readEnv(env, "WATCHER_CONFIRM_QUORUM"), false),
    tronContractAddress: readEnv(env, "WATCHER_USDT_CONTRACT")?.trim() || USDT_TRC20_CONTRACT,
    tronPrimaryUrl: readEnv(env, "TRON_RPC_PRIMARY_URL")?.trim() || "https://api.trongrid.io",
    tronSecondaryUrl: readEnv(env, "TRON_RPC_SECONDARY_URL")?.trim() || "",
    tronGridApiKey: readEnv(env, "TRONGRID_API_KEY")?.trim() || "",
    tronSecondaryApiKey: readEnv(env, "TRON_RPC_SECONDARY_API_KEY")?.trim() || "",
  };
}
