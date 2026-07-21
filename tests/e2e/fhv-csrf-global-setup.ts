import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

/**
 * Migrate the isolated FHV CSRF E2E sqlite database before `pnpm dev`.
 */
export default function globalSetup(): void {
  const databaseUrl = process.env.FHV_CSRF_DATABASE_URL ?? "file:./.data/fhv-csrf-e2e.sqlite";
  process.env.DATABASE_URL = databaseUrl;
  mkdirSync(".data", { recursive: true });

  const res = spawnSync("pnpm", ["db:migrate"], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (res.status !== 0) {
    throw new Error("[fhv-csrf globalSetup] pnpm db:migrate failed");
  }
}
