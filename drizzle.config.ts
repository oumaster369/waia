import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL ?? "file:./.data/waia.db";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "sqlite",
  dbCredentials: { url },
});
