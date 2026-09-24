import { defineConfig } from "@playwright/test";

const postgresUrl =
  process.env.DATABASE_URL_POSTGRES ?? "postgres://waia:waia@127.0.0.1:5432/waia_test";
const hostname = new URL(postgresUrl).hostname;
if (hostname !== "127.0.0.1" && hostname !== "localhost") {
  throw new Error("admin postgres e2e refuses a non-local database");
}
const sqliteUrl = "file:./.data/waia-admin-pg-e2e.db";
process.env.DATABASE_URL_POSTGRES = postgresUrl;
process.env.DATABASE_URL = sqliteUrl;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /admin-console-pg.*\.spec\.ts/,
  timeout: 180_000,
  workers: 1,
  use: { baseURL: "http://trader.localhost:3000", trace: "on-first-retry" },
  webServer: {
    command:
      "mkdir -p .data && pnpm db:migrate && pnpm exec next dev --hostname 0.0.0.0 --port 3000",
    url: "http://127.0.0.1:3000/",
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      WAIA_DB_BACKEND: "sqlite",
      WAIA_ADMIN_CONSOLE_DB: "postgres",
      DATABASE_URL_POSTGRES: postgresUrl,
      DATABASE_URL_POSTGRES_SESSION: postgresUrl,
      DATABASE_URL: sqliteUrl,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
      NEXT_PUBLIC_TRADER_URL: "http://trader.localhost:3000",
      WAIA_PRIMARY_HOST: "127.0.0.1",
      WAIA_TRADER_HOST: "trader.localhost",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      WAIA_AI_PROVIDER: "fake",
      WAIA_AI_OPENAI_API_KEY: "",
    },
  },
});
