import { getCloudflareContext } from "@opennextjs/cloudflare";

function bridgeEnvKey(env: Record<string, unknown>, key: string): void {
  const value = env[key];
  if (typeof value === "string" && value.trim() !== "") {
    process.env[key] = value;
  }
}

/** Cron scheduled handlers receive secrets on `env`, not always on `process.env`. */
export function bridgeTraderCronEnvToProcess(env: Record<string, unknown>): void {
  bridgeEnvKey(env, "DATABASE_URL_POSTGRES");
  bridgeEnvKey(env, "DATABASE_URL");
  bridgeEnvKey(env, "WAIA_DB_BACKEND");
  bridgeEnvKey(env, "MARKET_BRAIN_ENABLED");
  bridgeEnvKey(env, "MARKET_BRAIN_ORGANIZATION_ID");
  bridgeEnvKey(env, "HTX_REST_HOST");
  bridgeEnvKey(env, "PAPER_LOOP_ENABLED");
  bridgeEnvKey(env, "PAPER_LOOP_ORGANIZATION_ID");
  bridgeEnvKey(env, "PAPER_LOOP_ACCOUNT_KEY");
  bridgeEnvKey(env, "PAPER_LOOP_DEFAULT_QUANTITY");
  bridgeEnvKey(env, "PAPER_LOOP_CYCLE_ID_PREFIX");
  bridgeEnvKey(env, "SETTLEMENT_MAX_PAYMENTS_PER_CYCLE");
}

export function mergeCronEnv(explicitEnv?: Record<string, unknown>): Record<string, unknown> {
  if (explicitEnv) {
    // Cron passes secrets on `env`; avoid Object.entries(process.env) in workerd.
    return explicitEnv;
  }
  try {
    const cfEnv = getCloudflareContext().env as unknown as Record<string, unknown>;
    return { ...process.env, ...cfEnv };
  } catch {
    return { ...process.env };
  }
}
