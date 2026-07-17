import postgres from "postgres";

export type HtrPostgresConnectionEnvironment = Readonly<{
  host: string;
  port: number;
  database: string;
  role: string;
  source: "explicit proof environment";
}>;

/** Local validate-stack URL — do not log or embed in evidence artifacts. */
const LOCAL_VALIDATION_URL =
  "postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate";

const BLOCKED_ROLES = new Set(["authenticated", "anon", "service_role"]);

export function assertHtrPostgresConnectionEnvironment(): HtrPostgresConnectionEnvironment {
  if (process.env.WAIA_PG_INTEGRATION !== "1") {
    throw new Error("HTR_WP22_PG_PREFLIGHT:WAIA_PG_INTEGRATION_REQUIRED");
  }

  if (process.env.WAIA_DB_BACKEND !== "postgres") {
    throw new Error("HTR_WP22_PG_PREFLIGHT:WAIA_DB_BACKEND_POSTGRES_REQUIRED");
  }

  const url = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!url) {
    throw new Error("HTR_WP22_PG_PREFLIGHT:DATABASE_URL_POSTGRES_MISSING");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("HTR_WP22_PG_PREFLIGHT:DATABASE_URL_POSTGRES_INVALID");
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  const database = parsed.pathname.replace(/^\//, "");
  const role = decodeURIComponent(parsed.username);

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("HTR_WP22_PG_PREFLIGHT:NON_LOCAL_HOST");
  }
  if (port !== 54329) {
    throw new Error("HTR_WP22_PG_PREFLIGHT:UNEXPECTED_PORT");
  }
  if (database !== "waia_validate") {
    throw new Error("HTR_WP22_PG_PREFLIGHT:UNEXPECTED_DATABASE");
  }
  if (BLOCKED_ROLES.has(role) || role !== "waia_validate") {
    throw new Error("HTR_WP22_PG_PREFLIGHT:UNEXPECTED_ROLE");
  }
  if (parsed.hostname.includes("supabase") || parsed.hostname.includes("pooler")) {
    throw new Error("HTR_WP22_PG_PREFLIGHT:POOLER_OR_PRODUCTION_ENDPOINT");
  }

  return { host, port, database, role, source: "explicit proof environment" };
}

export async function verifyHtrPostgresConnectionIdentity(
  url = process.env.DATABASE_URL_POSTGRES?.trim() ?? LOCAL_VALIDATION_URL,
): Promise<HtrPostgresConnectionEnvironment> {
  const env = assertHtrPostgresConnectionEnvironment();
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql.unsafe<{ role: string; database: string }[]>(
      `SELECT current_user AS role, current_database() AS database`,
    );
    const role = rows[0]?.role ?? "";
    const database = rows[0]?.database ?? "";
    if (role !== env.role || database !== env.database) {
      throw new Error("HTR_WP22_PG_PREFLIGHT:CONNECTION_IDENTITY_MISMATCH");
    }
    if (BLOCKED_ROLES.has(role)) {
      throw new Error("HTR_WP22_PG_PREFLIGHT:BLOCKED_ROLE_ACTIVE");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return env;
}

/** Canonical local validation profile URL (password must not appear in logs or evidence). */
export const HTR_LOCAL_VALIDATION_DATABASE_URL = LOCAL_VALIDATION_URL;
