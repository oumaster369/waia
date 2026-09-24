import { getCloudflareContext } from "@opennextjs/cloudflare";

const workerEnvGlobal = globalThis as { __waiaWorkerEnv?: Record<string, unknown> };

/** Keep the Worker env for code that only reads process.env. */
export function rememberWorkerEnv(env: Record<string, unknown>): void {
  workerEnvGlobal.__waiaWorkerEnv = env;
}

export function workerEnvString(key: string): string {
  const value = workerEnvGlobal.__waiaWorkerEnv?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function bridgeEnvKey(
  env: Record<string, unknown>,
  key: string,
  mode: "override" | "fill" = "override",
): void {
  const value = env[key];
  if (typeof value !== "string" || value.trim() === "") return;
  if (mode === "fill" && (process.env[key]?.trim() ?? "") !== "") return;
  process.env[key] = value;
}

/** Cron scheduled handlers receive secrets on `env`, not always on `process.env`. */
export function bridgeTraderCronEnvToProcess(env: Record<string, unknown>): void {
  bridgeEnvKey(env, "DATABASE_URL_POSTGRES", "override");
  bridgeEnvKey(env, "DATABASE_URL", "override");
  bridgeEnvKey(env, "WAIA_DB_BACKEND", "override");
  bridgeEnvKey(env, "MARKET_BRAIN_ENABLED");
  bridgeEnvKey(env, "MARKET_BRAIN_ORGANIZATION_ID");
  bridgeEnvKey(env, "HTX_REST_HOST");
  bridgeEnvKey(env, "COINGECKO_API_KEY");
  bridgeEnvKey(env, "FRED_API_KEY");
  bridgeEnvKey(env, "AI_TRADER_INFURA_PROJECT_ID");
  bridgeEnvKey(env, "AI_TRADER_INFURA_API_SECRET");
  bridgeEnvKey(env, "AI_TRADER_TRONGRID_API_KEY");
  bridgeEnvKey(env, "AI_TRADER_GITHUB_TOKEN");
  bridgeEnvKey(env, "AI_TRADER_SEC_EDGAR_USER_AGENT");
  bridgeEnvKey(env, "AI_TRADER_CME_FEDWATCH_ENABLED");
  bridgeEnvKey(env, "PAPER_LOOP_ENABLED");
  bridgeEnvKey(env, "PAPER_LOOP_ORGANIZATION_ID");
  bridgeEnvKey(env, "PAPER_LOOP_ACCOUNT_KEY");
  bridgeEnvKey(env, "PAPER_LOOP_DEFAULT_QUANTITY");
  bridgeEnvKey(env, "PAPER_LOOP_CYCLE_ID_PREFIX");
  bridgeEnvKey(env, "SETTLEMENT_MAX_PAYMENTS_PER_CYCLE");
}

function fillRequestDatabaseEnv(env: Record<string, unknown>): void {
  rememberWorkerEnv(env);
  bridgeEnvKey(env, "DATABASE_URL_POSTGRES", "fill");
  bridgeEnvKey(env, "DATABASE_URL", "fill");
  bridgeEnvKey(env, "WAIA_DB_BACKEND", "fill");
}

/** Request handlers see Worker secrets on the Cloudflare env, not on process.env. */
export async function bridgeRequestDatabaseEnv(): Promise<void> {
  const backendReady = (process.env.WAIA_DB_BACKEND?.trim() ?? "") !== "";
  const urlReady = (process.env.DATABASE_URL_POSTGRES?.trim() ?? "") !== "";
  if (backendReady && urlReady) return;
  try {
    const context = await getCloudflareContext({ async: true });
    fillRequestDatabaseEnv(context.env as unknown as Record<string, unknown>);
  } catch {
    try {
      const context = getCloudflareContext();
      fillRequestDatabaseEnv(context.env as unknown as Record<string, unknown>);
    } catch {
      // Local tests and non-Worker runs keep the process environment they already have.
    }
  }
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
