import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit config for the **Postgres** schema (`db/schema.postgres.ts`).
 *
 * - Does not replace [`drizzle.config.ts`](./drizzle.config.ts) (SQLite remains the active app schema for `pnpm db:*` today).
 * - Use `DATABASE_URL_POSTGRES` for Supabase / Postgres (pooler or direct). Example:
 *   `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`
 *
 * **D6-pre:** versioned SQL in `db/migrations_postgres` is the apply target; see `docs/postgres-development.md`.
 */
const url =
  process.env.DATABASE_URL_POSTGRES ?? "postgresql://127.0.0.1:5432/waia_postgres_schema_placeholder";

export default defineConfig({
  schema: "./db/schema.postgres.ts",
  out: "./db/migrations_postgres",
  dialect: "postgresql",
  dbCredentials: { url },
});
