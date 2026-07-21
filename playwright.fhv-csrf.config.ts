import { defineConfig, devices } from "@playwright/test";

/** Isolated dev-server E2E for FHV browser CSRF proof (local_file adapter only — never production). */
const FHV_CSRF_PORT = Number(process.env.PLAYWRIGHT_FHV_CSRF_PORT ?? 3201);
const BASE_URL = process.env.PLAYWRIGHT_FHV_CSRF_BASE_URL ?? `http://127.0.0.1:${FHV_CSRF_PORT}`;
const FHV_CSRF_DATABASE_URL =
  process.env.FHV_CSRF_DATABASE_URL ?? "file:./.data/fhv-csrf-e2e.sqlite";
const FHV_CSRF_STATUS_PATH =
  process.env.FHV_OPERATOR_STATUS_PATH ?? ".data/fhv-csrf-e2e-status.json";

process.env.DATABASE_URL = FHV_CSRF_DATABASE_URL;
process.env.FHV_CSRF_DATABASE_URL = FHV_CSRF_DATABASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/fhv-csrf-global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /fhv-operations-csrf-browser\.spec\.ts/,
    },
  ],
  webServer: {
    command: [
      `mkdir -p .data`,
      `&&`,
      `DATABASE_URL=${FHV_CSRF_DATABASE_URL}`,
      `pnpm db:migrate`,
      `&&`,
      `PORT=${FHV_CSRF_PORT}`,
      `NEXT_PUBLIC_SITE_URL=${BASE_URL}`,
      `NEXT_PUBLIC_TRADER_URL=http://trader.localhost:${FHV_CSRF_PORT}`,
      `WAIA_DB_BACKEND=sqlite`,
      `DATABASE_URL=${FHV_CSRF_DATABASE_URL}`,
      `NEXT_PUBLIC_SUPABASE_URL=`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=`,
      `WAIA_PRIMARY_HOST=127.0.0.1`,
      `WAIA_TRADER_HOST=trader.localhost`,
      `FHV_ADMIN_CSRF_SECRET=fhv-csrf-e2e-secret`,
      `FHV_OPERATOR_COMMAND_SECRET=fhv-csrf-e2e-command-secret`,
      `FHV_STATUS_ADAPTER=local_file`,
      `FHV_OPERATOR_STATUS_PATH=${FHV_CSRF_STATUS_PATH}`,
      `pnpm dev`,
    ].join(" "),
    url: BASE_URL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 300_000,
    env: {
      PORT: String(FHV_CSRF_PORT),
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      WAIA_DB_BACKEND: "sqlite",
      DATABASE_URL: FHV_CSRF_DATABASE_URL,
      NEXT_PUBLIC_SITE_URL: BASE_URL,
      WAIA_PRIMARY_HOST: "127.0.0.1",
      WAIA_TRADER_HOST: "trader.localhost",
      NEXT_PUBLIC_TRADER_URL: `http://trader.localhost:${FHV_CSRF_PORT}`,
      FHV_ADMIN_CSRF_SECRET: "fhv-csrf-e2e-secret",
      FHV_OPERATOR_COMMAND_SECRET: "fhv-csrf-e2e-command-secret",
      FHV_STATUS_ADAPTER: "local_file",
      FHV_OPERATOR_STATUS_PATH: FHV_CSRF_STATUS_PATH,
    },
  },
});
