import { defineConfig } from "drizzle-kit";

import { resolveDatabaseUrlPostgresForKit } from "./drizzle/load-postgres-env-for-kit";

/**
 * Drizzle Kit config for the **Postgres** schema (`db/schema.postgres.ts`).
 *
 * - Does not replace [`drizzle.config.ts`](./drizzle.config.ts) (SQLite remains the active app schema for `pnpm db:*` today).
 * - Use `DATABASE_URL_POSTGRES` for Supabase / Postgres (pooler or direct). Example:
 *   `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
 * - Loads `.env` then `.env.local` when the variable is not already exported (mirrors Next.js local dev).
 *
 * **D6-pre:** versioned SQL in `db/migrations_postgres` is the apply target; see `docs/postgres-development.md`.
 */
const url = resolveDatabaseUrlPostgresForKit();

export default defineConfig({
  schema: "./db/schema.postgres.ts",
  out: "./db/migrations_postgres",
  dialect: "postgresql",
  dbCredentials: { url },
});
