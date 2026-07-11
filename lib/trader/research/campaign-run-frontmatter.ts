import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import type { CampaignPostgresUrlSource } from "@/db/postgres-client";
import { resolveCampaignPostgresUrl } from "@/db/postgres-client";

/** Execution surface ids — must match [`docs/ops/EXECUTION-SURFACES.md`](../../../docs/ops/EXECUTION-SURFACES.md). */
export const EXECUTION_SURFACE_IDS = [
  "local",
  "cursor-agent",
  "github-actions",
  "cloudflare-preview",
  "cloudflare-production",
  "supabase-postgres",
  "execution-server",
] as const;

export type ExecutionSurfaceId = (typeof EXECUTION_SURFACE_IDS)[number];

export type DbConnectionMode = CampaignPostgresUrlSource | "postgres" | "sqlite" | "none";

export type CampaignRunFrontmatter = {
  runId: string;
  executionOrigin: ExecutionSurfaceId;
  gitSha: string | null;
  environment: string;
  dbConnectionMode: DbConnectionMode;
};

export type BuildCampaignRunFrontmatterInput = {
  runId?: string;
  dbConnectionMode?: DbConnectionMode;
  gitSha?: string | null;
};

function resolveGitSha(explicit?: string | null): string | null {
  if (explicit !== undefined) {
    return explicit;
  }
  return process.env.GITHUB_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null;
}

/**
 * Resolves the WAIA execution surface for CLI campaign provenance (DEE-407).
 * Honors `WAIA_EXECUTION_SURFACE` when set to a known surface id; otherwise infers.
 */
export function resolveExecutionOrigin(): ExecutionSurfaceId {
  const explicit = process.env.WAIA_EXECUTION_SURFACE?.trim();
  if (explicit && (EXECUTION_SURFACE_IDS as readonly string[]).includes(explicit)) {
    return explicit as ExecutionSurfaceId;
  }

  if (process.env.WAIA_EXECUTION_SERVER === "1") {
    return "execution-server";
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    return "github-actions";
  }
  if (process.env.CF_PAGES === "1" || process.env.CLOUDFLARE_PAGES === "1") {
    return "cloudflare-preview";
  }
  if (process.env.CURSOR_AGENT === "1") {
    return "cursor-agent";
  }
  return "local";
}

/** Campaign/runtime environment label for evidence manifests (non-secret). */
export function resolveCampaignEnvironment(): string {
  const explicit = process.env.WAIA_ENV?.trim();
  if (explicit) {
    return explicit;
  }
  if (process.env.WAIA_EXECUTION_SERVER === "1") {
    return "execution-server";
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    return "ci";
  }
  if (process.env.NODE_ENV === "test") {
    return "test";
  }
  return process.env.NODE_ENV ?? "development";
}

/**
 * Resolves how the CLI connected to persistence for provenance sealing.
 * Long-running M9 campaigns pass `urlSource` from {@link createLongRunningCampaignPostgresRuntime}.
 */
export function resolveDbConnectionMode(explicit?: DbConnectionMode): DbConnectionMode {
  if (explicit) {
    return explicit;
  }

  if (process.env.WAIA_DB_BACKEND === "sqlite") {
    return "sqlite";
  }

  const hasPostgres =
    Boolean(process.env.DATABASE_URL_POSTGRES_SESSION?.trim()) ||
    Boolean(process.env.DATABASE_URL_POSTGRES?.trim());
  if (!hasPostgres) {
    return "none";
  }

  try {
    return resolveCampaignPostgresUrl().source;
  } catch {
    return "postgres";
  }
}

export function buildCampaignRunFrontmatter(
  input: BuildCampaignRunFrontmatterInput = {},
): CampaignRunFrontmatter {
  return {
    runId: input.runId ?? crypto.randomUUID(),
    executionOrigin: resolveExecutionOrigin(),
    gitSha: resolveGitSha(input.gitSha),
    environment: resolveCampaignEnvironment(),
    dbConnectionMode: resolveDbConnectionMode(input.dbConnectionMode),
  };
}
