import { createRequire } from "node:module";

import { createPerRequestPostgresRuntime } from "@/db/postgres-client";
import { createPostgresCollectorStore } from "@/lib/trader/admin-console/collectors/postgres-store";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") require("server-only");

export async function recordHostDiagnostic(input: {
  service: string;
  error: unknown;
}): Promise<void> {
  const url = process.env.DATABASE_URL_POSTGRES?.trim();
  if (!url) throw new Error("DIAGNOSTICS_DATABASE_UNAVAILABLE");
  const runtime = createPerRequestPostgresRuntime();
  try {
    const store = createPostgresCollectorStore(runtime.db);
    await store.recordDiagnostic(input);
  } finally {
    await runtime._sql.end({ timeout: 5 });
  }
}
