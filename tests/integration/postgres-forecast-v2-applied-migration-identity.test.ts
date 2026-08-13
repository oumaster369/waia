/**
 * Live Drizzle __drizzle_migrations binding for Forecast V2 0146/0147.
 * Opt-in: WAIA_PG_INTEGRATION=1
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED,
  assertForecastV2AppliedMigrationIdentity,
} from "@/lib/trader/intelligence/forecast-v2/forecast-v2-applied-migration-identity-v1";
import { assertForecastV2MigrationRange } from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import { A3_REPO_ROOT } from "./a3-storage-scale-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres forecast-v2 applied migration identity",
  () => {
    it("binds journal file hashes to drizzle.__drizzle_migrations through ratified 0148", async () => {
      const sql = postgres(url!, { max: 1 });
      try {
        const identity = await assertForecastV2AppliedMigrationIdentity(sql, A3_REPO_ROOT);
        expect(identity.max).toBe(FORECAST_V2_STORAGE_MIGRATION_MAX_EXPECTED);
        for (const tag of identity.requiredClosureViTags) {
          const binding = identity.bindings.find((b) => b.tag === tag);
          expect(binding, tag).toBeTruthy();
          const fileHash = createHash("sha256")
            .update(readFileSync(join(A3_REPO_ROOT, "db/migrations_postgres", `${tag}.sql`)))
            .digest("hex");
          expect(binding!.contentHash).toBe(fileHash);
          expect(binding!.dbHash).toBe(fileHash);
        }
        const range = await assertForecastV2MigrationRange(sql, A3_REPO_ROOT);
        expect(range.max).toBe(identity.max);
        expect(range.min).toBe(110);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });
  },
);
