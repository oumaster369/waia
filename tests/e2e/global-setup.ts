import { spawnSync } from "node:child_process";

/**
 * Ensure local SQLite matches Drizzle migrations before `pnpm build && pnpm start`.
 * Prevents E2E flakes when `.data/waia.db` predates newer columns (e.g. twin dialogue embeddings).
 */
export default function globalSetup(): void {
  const res = spawnSync("pnpm", ["db:migrate"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (res.status !== 0) {
    throw new Error("[e2e globalSetup] pnpm db:migrate failed");
  }
}
