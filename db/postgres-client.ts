import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as pgSchema from "@/db/schema.postgres";

type GlobalPostgres = typeof globalThis & {
  __waia_postgres_js__?: postgres.Sql;
  __waia_postgres_drizzle__?: PostgresJsDatabase<typeof pgSchema>;
};

const globalStore = globalThis as GlobalPostgres;

/** Inline budget when `waitUntil` is unavailable (tests / Node); close continues in background via isolate GC if needed. */
export const POSTGRES_CLOSE_INLINE_BUDGET_MS = 200;
export const POSTGRES_CLOSE_GRACE_TIMEOUT_S = 5;

/** Result of {@link disposePostgresClientSafely}; omitted from telemetry when close was deferred via `waitUntil`. */
export type PostgresDisposeOutcome = "ok" | "timeout" | "error";

/**
 * Default **true**: one `postgres.js` client per `getWaiaRuntimeDb()` call (DEE-110 / Workers-safe).
 * Set to `false`, `0`, `no`, or `off` for emergency rollback to the legacy global singleton (known unstable on Workers).
 */
export function shouldUsePerRequestPostgresClient(): boolean {
  const raw = process.env.WAIA_POSTGRES_PER_REQUEST_CLIENT?.trim().toLowerCase() ?? "";
  if (raw === "" || raw === "true" || raw === "1" || raw === "yes" || raw === "on") {
    return true;
  }
  if (raw === "false" || raw === "0" || raw === "no" || raw === "off") {
    return false;
  }
  return true;
}

/**
 * Driver options for `postgres.js` against Supabase **transaction pooler** (and similar PgBouncer
 * transaction modes): prepared statements are unsafe/disallowed — Workers observed hung requests
 * until Cloudflare canceled them (`prepare: false` fixes that path).
 *
 * Opt into prepared statements locally only: `WAIA_POSTGRES_PREPARE_STATEMENTS=true` (direct Postgres /
 * session pooler).
 */
export function waiaPostgresJsDriverOptions(): { max: number; prepare: boolean } {
  return {
    max: 1,
    prepare: process.env.WAIA_POSTGRES_PREPARE_STATEMENTS === "true",
  };
}

function ensurePostgresSingleton(): {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof pgSchema>;
} {
  if (!globalStore.__waia_postgres_drizzle__ || !globalStore.__waia_postgres_js__) {
    const url = process.env.DATABASE_URL_POSTGRES?.trim();
    if (!url) {
      throw new Error("[waia] DATABASE_URL_POSTGRES is not set or empty.");
    }
    const sql = postgres(url, waiaPostgresJsDriverOptions());
    const db = drizzle(sql, { schema: pgSchema });
    globalStore.__waia_postgres_js__ = sql;
    globalStore.__waia_postgres_drizzle__ = db;
  }
  return {
    sql: globalStore.__waia_postgres_js__!,
    db: globalStore.__waia_postgres_drizzle__!,
  };
}

/**
 * Creates a fresh Postgres + Drizzle pair for this request only (DEE-110).
 * Caller **must** {@link disposePostgresClientSafely} on `_sql` when done (typically in `finally`).
 */
export function createPerRequestPostgresRuntime(): {
  kind: "postgres";
  db: PostgresJsDatabase<typeof pgSchema>;
  _sql: postgres.Sql;
} {
  const url = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!url) {
    throw new Error("[waia] DATABASE_URL_POSTGRES is not set or empty.");
  }
  const sql = postgres(url, waiaPostgresJsDriverOptions());
  const db = drizzle(sql, { schema: pgSchema });
  return { kind: "postgres", db, _sql: sql };
}

/**
 * Driver options for long-running single-connection CLI campaigns (DEE-399 / M9 research
 * campaign). Transaction-mode Supavisor pooling (`:6543`) recycles held connections after a
 * bounded lifetime, which is fatal to a multi-hour single-connection replay (observed as
 * Repeat M9 v0.1.7 `CAMPAIGN_CRASH` — `write CONNECTION_CLOSED …pooler.supabase.com:6543`).
 * These options proactively rotate the connection and keep it alive between long-idle cycles;
 * see {@link resolveCampaignPostgresUrl} for the companion session-mode/direct URL preference.
 */
export function waiaCampaignPostgresDriverOptions(): {
  max: number;
  prepare: boolean;
  idle_timeout: number;
  connect_timeout: number;
  max_lifetime: number;
  keep_alive: number;
} {
  return {
    max: 1,
    prepare: process.env.WAIA_POSTGRES_PREPARE_STATEMENTS === "true",
    idle_timeout: 0,
    connect_timeout: 30,
    max_lifetime: 1800,
    keep_alive: 30,
  };
}

/** Which connection string a long-running campaign runtime resolved to. */
export type CampaignPostgresUrlSource = "session" | "transaction_fallback";

export type CampaignPostgresUrlResolution = {
  url: string;
  source: CampaignPostgresUrlSource;
};

/**
 * Resolves the mandatory direct/session PostgreSQL endpoint used by workflows that hold a
 * session advisory lock. There is deliberately no `DATABASE_URL_POSTGRES` fallback: a
 * transaction-pooler connection can change backend between statements and invalidate the lock.
 */
export function resolveRequiredSessionPostgresUrl(): string {
  const raw = process.env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (!raw) {
    throw new Error(
      "[waia] DATABASE_URL_POSTGRES_SESSION is required for session-locked production workflows; " +
      "DATABASE_URL_POSTGRES fallback is forbidden.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("[waia] DATABASE_URL_POSTGRES_SESSION is not a valid PostgreSQL URL.");
  }
  const protocol = parsed.protocol.toLowerCase();
  const declaredPoolMode =
    parsed.searchParams.get("pool_mode") ?? parsed.searchParams.get("poolmode");
  if (
    (protocol !== "postgres:" && protocol !== "postgresql:") ||
    !parsed.hostname ||
    parsed.port === "6543" ||
    declaredPoolMode?.trim().toLowerCase() === "transaction"
  ) {
    throw new Error(
      "[waia] DATABASE_URL_POSTGRES_SESSION must be a direct or session-mode PostgreSQL URL; " +
      "transaction pooling is forbidden.",
    );
  }
  return raw;
}

/** Driver options that preserve one held backend for a potentially long DEE-917/918 flow. */
export function waiaSessionLockedPostgresDriverOptions(): {
  max: number;
  prepare: boolean;
  idle_timeout: number;
  connect_timeout: number;
  max_lifetime: null;
  keep_alive: number;
} {
  return {
    max: 1,
    prepare: false,
    idle_timeout: 0,
    connect_timeout: 30,
    max_lifetime: null,
    keep_alive: 30,
  };
}

/**
 * Narrow scoped client for session-lock critical sections. Unlike campaign resolution this
 * helper never falls back to the transaction pooler and never exposes a Drizzle/global client.
 */
export async function withRequiredSessionPostgresClient<T>(
  fn: (sql: postgres.Sql) => Promise<T>,
): Promise<T> {
  const sql = postgres(
    resolveRequiredSessionPostgresUrl(),
    waiaSessionLockedPostgresDriverOptions(),
  );
  try {
    return await fn(sql);
  } finally {
    await disposePostgresClientSafely(sql);
  }
}

/**
 * Resolves the connection string for long-running campaign CLIs: prefers
 * `DATABASE_URL_POSTGRES_SESSION` (Supabase session-mode pooler `:5432` or a direct
 * `db.<ref>.supabase.co:5432` connection — both stable for held single connections), falling
 * back to `DATABASE_URL_POSTGRES` (transaction pooler) with a loud warning. The transaction
 * pooler is known crash-prone for multi-hour single-connection CLI runs; this fallback keeps
 * the campaign runnable while making the risk explicit rather than silent.
 */
export function resolveCampaignPostgresUrl(): CampaignPostgresUrlResolution {
  const sessionUrl = process.env.DATABASE_URL_POSTGRES_SESSION?.trim();
  if (sessionUrl) {
    return { url: sessionUrl, source: "session" };
  }

  const transactionUrl = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!transactionUrl) {
    throw new Error(
      "[waia] Neither DATABASE_URL_POSTGRES_SESSION nor DATABASE_URL_POSTGRES is set.",
    );
  }

  console.warn(
    "[waia] DATABASE_URL_POSTGRES_SESSION is not set — falling back to DATABASE_URL_POSTGRES " +
      "(Supabase transaction pooler). Multi-hour single-connection CLI campaigns are known to " +
      "be crash-prone against transaction-mode pooling (see DEE-399). Set " +
      "DATABASE_URL_POSTGRES_SESSION to a Supabase session-mode pooler (:5432) or direct " +
      "connection before running long research campaigns.",
  );
  return { url: transactionUrl, source: "transaction_fallback" };
}

/**
 * Creates a resilient, long-lived Postgres + Drizzle pair for multi-hour CLI campaigns (M9
 * research campaign). Caller **must** {@link disposePostgresClientSafely} on `_sql` when done
 * (typically in `finally`), mirroring {@link createPerRequestPostgresRuntime}.
 */
export function createLongRunningCampaignPostgresRuntime(): {
  kind: "postgres";
  db: PostgresJsDatabase<typeof pgSchema>;
  _sql: postgres.Sql;
  urlSource: CampaignPostgresUrlSource;
} {
  const { url, source } = resolveCampaignPostgresUrl();
  const sql = postgres(url, waiaCampaignPostgresDriverOptions());
  const db = drizzle(sql, { schema: pgSchema });
  return { kind: "postgres", db, _sql: sql, urlSource: source };
}

/**
 * Bounded exponential-backoff retry policy for campaign DB operations (DEE-399).
 */
export type CampaignDbRetryPolicy = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_CAMPAIGN_DB_RETRY_POLICY: CampaignDbRetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

const TRANSIENT_CONNECTION_ERROR_CODES = new Set([
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "CONNECT_TIMEOUT",
  "EPIPE",
]);

const TRANSIENT_CONNECTION_ERROR_MESSAGE_PATTERN =
  /connection[_\s-]?(closed|ended|reset|terminated)|\bwrite\b.*\bclosed\b|\bread\b.*\bclosed\b|\bconnect(ion)?\s*timeout\b/i;

/**
 * True only for signatures known to be transient Postgres/network connection failures (socket
 * closed/reset/timed out by a pooler or network hop) — never for query/logic/domain errors.
 * Used to decide whether a campaign DB operation is safe to retry (see
 * {@link withCampaignDbRetry}) and to classify an unrecovered disconnect honestly at campaign
 * finalization time (never as a fabricated success, never as a misleadingly generic crash).
 */
export function isTransientConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const code = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (code && TRANSIENT_CONNECTION_ERROR_CODES.has(code)) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_CONNECTION_ERROR_MESSAGE_PATTERN.test(message);
}

/**
 * Deterministic bounded exponential backoff with full jitter (delay uniformly drawn from
 * `[0, min(maxDelayMs, baseDelayMs * 2^attempt)]`) — same shape as the HTX transport retry
 * policy (`lib/trader/connectors/htx/transport-policy.ts`), reused here for campaign DB ops.
 */
export function computeCampaignDbRetryDelayMs(
  attempt: number,
  policy: CampaignDbRetryPolicy = DEFAULT_CAMPAIGN_DB_RETRY_POLICY,
  random: () => number = Math.random,
): number {
  const exponential = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(policy.maxDelayMs, exponential);
  return Math.round(random() * capped);
}

export type WithCampaignDbRetryOptions = {
  policy?: CampaignDbRetryPolicy;
  isTransient?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries `fn` only when {@link isTransientConnectionError} (or a caller-supplied classifier)
 * identifies the failure as a transient connection error, using bounded exponential backoff
 * with jitter. Any non-transient error rethrows immediately without retry.
 *
 * **Caller contract:** only wrap idempotent operations (reads, upserts, or writes guarded by
 * content/idempotency keys). Never wrap a non-idempotent multi-step operation — in particular,
 * never wrap the research pipeline run itself; a retried partial pipeline run could double a
 * side effect or resume across an inconsistent state. If retries are exhausted, the original
 * (transient) error is rethrown unchanged so campaign finalization can classify it honestly.
 */
export async function withCampaignDbRetry<T>(
  fn: () => Promise<T>,
  options: WithCampaignDbRetryOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_CAMPAIGN_DB_RETRY_POLICY;
  const isTransient = options.isTransient ?? isTransientConnectionError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === policy.maxAttempts - 1;
      if (!isTransient(error) || isLastAttempt) {
        throw error;
      }
      const delayMs = computeCampaignDbRetryDelayMs(attempt, policy, random);
      options.onRetry?.(attempt + 1, error, delayMs);
      await sleep(delayMs);
    }
  }
  // Unreachable: the loop always returns or throws; satisfies the compiler's control-flow check.
  throw new Error("[waia] withCampaignDbRetry: retry loop exited without result");
}

/**
 * Never block the HTTP response on socket teardown: prefer `waitUntil(close)`, else bounded inline wait.
 */
export async function disposePostgresClientSafely(
  sql: postgres.Sql,
): Promise<PostgresDisposeOutcome | undefined> {
  let resolvedOutcome: PostgresDisposeOutcome = "ok";

  const closePromise = sql.end({ timeout: POSTGRES_CLOSE_GRACE_TIMEOUT_S }).then(
    () => {
      resolvedOutcome = "ok";
    },
    () => {
      resolvedOutcome = "error";
    },
  );

  try {
    const cfCtx = getCloudflareContext().ctx;
    if (cfCtx && typeof cfCtx.waitUntil === "function") {
      cfCtx.waitUntil(closePromise);
      return undefined;
    }
  } catch {
    /* sync context unavailable (Node dev, tests, static analysis path) */
  }

  const raced = await Promise.race([
    closePromise.then(() => "done" as const),
    new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), POSTGRES_CLOSE_INLINE_BUDGET_MS),
    ),
  ]);

  if (raced === "timeout") {
    return "timeout";
  }
  return resolvedOutcome;
}

/** Scoped client for scripts/tests; tears down via {@link disposePostgresClientSafely}. */
export async function withWaiaPostgresClient<T>(
  fn: (sql: postgres.Sql, db: PostgresJsDatabase<typeof pgSchema>) => Promise<T>,
): Promise<T> {
  const { _sql, db } = createPerRequestPostgresRuntime();
  try {
    return await fn(_sql, db);
  } finally {
    await disposePostgresClientSafely(_sql);
  }
}

/** Lazy Postgres + Drizzle singleton (legacy / emergency rollback only). */
export function getPostgresDrizzle(): PostgresJsDatabase<typeof pgSchema> {
  return ensurePostgresSingleton().db;
}

/** Raw `postgres` driver for low-level SQL (e.g. smoke cleanup). */
export function getPostgresSql(): postgres.Sql {
  return ensurePostgresSingleton().sql;
}

/** Testing only: closes the client and clears cached handles. */
export async function resetPostgresSingletonForTests(): Promise<void> {
  try {
    await globalStore.__waia_postgres_js__?.end({ timeout: 5 });
  } catch {
    /* ignore close errors during parallel teardown */
  }
  globalStore.__waia_postgres_js__ = undefined;
  globalStore.__waia_postgres_drizzle__ = undefined;
}
