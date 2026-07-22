import { createRequire } from "node:module";

/**
 * Enforce `server-only` when running under Next.js Node (has `import.meta.url`).
 * Skip in Vitest, Postgres CLI, and Cloudflare Worker cron isolates where
 * `import.meta.url` is absent and `createRequire` would throw at module load.
 */
export function enforceServerOnly(): void {
  if (process.env.VITEST === "true" || process.env.WAIA_POSTGRES_CLI === "1") {
    return;
  }
  const metaUrl = import.meta.url;
  if (typeof metaUrl !== "string" || metaUrl.length === 0) {
    return;
  }
  try {
    createRequire(metaUrl)("server-only");
  } catch {
    // Worker bundles may not resolve server-only; safe to skip outside Next.js Node.
  }
}
