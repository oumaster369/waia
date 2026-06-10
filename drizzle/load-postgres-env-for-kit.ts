import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Next.js-style local env files (lowest → highest precedence among files). */
const LOCAL_ENV_FILES = [".env", ".env.local"] as const;

/**
 * Minimal dotenv parse for Drizzle Kit only — does not mutate `process.env`.
 * Supports `KEY=value`, optional quotes, and `#` comments.
 */
export function parseEnvFileContent(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function readEnvFile(cwd: string, filename: string): Record<string, string> {
  const filePath = path.join(cwd, filename);
  if (!existsSync(filePath)) {
    return {};
  }
  return parseEnvFileContent(readFileSync(filePath, "utf8"));
}

function mergeLocalEnvFiles(cwd: string): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const filename of LOCAL_ENV_FILES) {
    Object.assign(merged, readEnvFile(cwd, filename));
  }
  return merged;
}

export type ResolveDatabaseUrlPostgresForKitInput = {
  cwd?: string;
  /**
   * Shell / CI value. When this key is present (even as `undefined`), `process.env`
   * is not consulted — useful for tests and explicit "no shell override" calls.
   */
  shellValue?: string | undefined;
};

function resolveShellDatabaseUrlPostgres(
  input: ResolveDatabaseUrlPostgresForKitInput,
): string | undefined {
  const raw = "shellValue" in input ? input.shellValue : process.env.DATABASE_URL_POSTGRES;
  const trimmed = raw?.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Resolves `DATABASE_URL_POSTGRES` for Drizzle Kit Postgres commands.
 *
 * Precedence (highest wins):
 * 1. Non-empty exported `process.env.DATABASE_URL_POSTGRES` (shell / CI)
 * 2. `.env.local`
 * 3. `.env`
 */
export function resolveDatabaseUrlPostgresForKit(
  input: ResolveDatabaseUrlPostgresForKitInput = {},
): string {
  const cwd = input.cwd ?? process.cwd();
  const shellTrimmed = resolveShellDatabaseUrlPostgres(input);
  if (shellTrimmed) {
    return shellTrimmed;
  }

  const fromFiles = mergeLocalEnvFiles(cwd).DATABASE_URL_POSTGRES?.trim();
  if (fromFiles) {
    return fromFiles;
  }

  throw new Error(
    [
      "[waia] DATABASE_URL_POSTGRES is not set for Drizzle Postgres tooling.",
      "Add it to `.env.local` (same as `pnpm dev`) or export it in the shell.",
      "CI and one-off overrides: DATABASE_URL_POSTGRES=<url> pnpm db:migrate:postgres",
    ].join(" "),
  );
}
