/**
 * D6-pre: optional real-Postgres connectivity guard (two sessions).
 * Does not assert transaction or rollback semantics — D6-core only.
 *
 * Enable with: WAIA_PG_INTEGRATION=1 and DATABASE_URL_POSTGRES set (see docs/postgres-development.md).
 */

import { describe, expect, it } from "vitest";
import postgres from "postgres";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)("postgres integration bootstrap (D6-pre)", () => {
  it("opens two independent sessions (future rollback tests need separate connections)", async () => {
    const sessionA = postgres(url!, { max: 1 });
    const sessionB = postgres(url!, { max: 1 });
    try {
      const [a, b] = await Promise.all([
        sessionA`SELECT 1 AS x`,
        sessionB`SELECT 1 AS y`,
      ]);
      expect(a[0]?.x).toBe(1);
      expect(b[0]?.y).toBe(1);
    } finally {
      await sessionA.end({ timeout: 5 });
      await sessionB.end({ timeout: 5 });
    }
  });
});
