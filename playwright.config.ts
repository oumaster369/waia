import { defineConfig, devices } from "@playwright/test";

const PLAYWRIGHT_PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3199);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${PLAYWRIGHT_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
      testIgnore: /trader-host\.spec\.ts/,
    },
    {
      name: "trader-host",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://trader.localhost:${PLAYWRIGHT_PORT}`,
      },
      testMatch: /trader-host\.spec\.ts/,
    },
  ],
  webServer: {
    command: [
      `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:${PLAYWRIGHT_PORT}`,
      `NEXT_PUBLIC_TRADER_URL=http://trader.localhost:${PLAYWRIGHT_PORT}`,
      `WAIA_DB_BACKEND=sqlite`,
      `DATABASE_URL=file:./.data/waia.db`,
      `NEXT_PUBLIC_SUPABASE_URL=`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=`,
      `WAIA_PRIMARY_HOST=127.0.0.1`,
      `WAIA_TRADER_HOST=trader.localhost`,
      `pnpm build`,
      `&&`,
      `PORT=${PLAYWRIGHT_PORT}`,
      `NEXT_PUBLIC_SITE_URL=http://127.0.0.1:${PLAYWRIGHT_PORT}`,
      `NEXT_PUBLIC_TRADER_URL=http://trader.localhost:${PLAYWRIGHT_PORT}`,
      `WAIA_DB_BACKEND=sqlite`,
      `DATABASE_URL=file:./.data/waia.db`,
      `NEXT_PUBLIC_SUPABASE_URL=`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=`,
      `WAIA_PRIMARY_HOST=127.0.0.1`,
      `WAIA_TRADER_HOST=trader.localhost`,
      `pnpm start`,
    ].join(" "),
    url: BASE_URL,
    /** Avoid stale local servers skipping `pnpm build && pnpm start` (causes flaky OAuth/sign-up E2E). Opt-in via PLAYWRIGHT_REUSE_SERVER=1. */
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
    env: {
      PORT: String(PLAYWRIGHT_PORT),
      /** Deterministic sqlite email auth for E2E (avoid Supabase “confirm email” stall when keys exist locally). */
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      WAIA_DB_BACKEND: "sqlite",
      DATABASE_URL: "file:./.data/waia.db",
      NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${PLAYWRIGHT_PORT}`,
      WAIA_PRIMARY_HOST: "127.0.0.1",
      WAIA_TRADER_HOST: "trader.localhost",
      NEXT_PUBLIC_TRADER_URL: `http://trader.localhost:${PLAYWRIGHT_PORT}`,
    },
  },
});
