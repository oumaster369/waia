import postgres from "postgres";

export type Wp21ProofPostgresEnvironment = Readonly<{
  host: string;
  port: number;
  database: string;
  role: string;
  source: "explicit proof environment";
}>;

const LOCAL_PROOF_URL =
  "postgresql://waia_validate:waia_validate_local_only@127.0.0.1:54329/waia_validate";

const BLOCKED_ROLES = new Set(["authenticated", "anon", "service_role"]);

export function assertWp21ProofPostgresEnvironment(): Wp21ProofPostgresEnvironment {
  if (process.env.WAIA_PG_INTEGRATION !== "1") {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:WAIA_PG_INTEGRATION_REQUIRED");
  }

  if (process.env.WAIA_DB_BACKEND !== "postgres") {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:WAIA_DB_BACKEND_POSTGRES_REQUIRED");
  }

  const url = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!url) {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:DATABASE_URL_POSTGRES_MISSING");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:DATABASE_URL_POSTGRES_INVALID");
  }

  const host = parsed.hostname;
  const port = Number(parsed.port || "5432");
  const database = parsed.pathname.replace(/^\//, "");
  const role = decodeURIComponent(parsed.username);

  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:NON_LOCAL_HOST");
  }
  if (port !== 54329) {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:UNEXPECTED_PORT");
  }
  if (database !== "waia_validate") {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:UNEXPECTED_DATABASE");
  }
  if (BLOCKED_ROLES.has(role) || role !== "waia_validate") {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:UNEXPECTED_ROLE");
  }
  if (parsed.hostname.includes("supabase") || parsed.hostname.includes("pooler")) {
    throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:POOLER_OR_PRODUCTION_ENDPOINT");
  }

  return { host, port, database, role, source: "explicit proof environment" };
}

export async function verifyWp21ProofPostgresConnectionIdentity(
  url = process.env.DATABASE_URL_POSTGRES?.trim() ?? LOCAL_PROOF_URL,
): Promise<Wp21ProofPostgresEnvironment> {
  const env = assertWp21ProofPostgresEnvironment();
  const sql = postgres(url, { max: 1 });
  try {
    const rows = await sql.unsafe<{ role: string; database: string }[]>(
      `SELECT current_user AS role, current_database() AS database`,
    );
    const role = rows[0]?.role ?? "";
    const database = rows[0]?.database ?? "";
    if (role !== env.role || database !== env.database) {
      throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:CONNECTION_IDENTITY_MISMATCH");
    }
    if (BLOCKED_ROLES.has(role)) {
      throw new Error("HTR_WP21_PROOF_PG_PREFLIGHT:BLOCKED_ROLE_ACTIVE");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return env;
}

export const WP21_LOCAL_PROOF_DATABASE_URL = LOCAL_PROOF_URL;
