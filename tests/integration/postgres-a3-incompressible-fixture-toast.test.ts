/**
 * Proves storage-only incompressible replica payloads do not collapse via TOAST
 * to the prior ~762-byte physical size of Buffer.alloc(65536, 0xab).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";

import { buildA3IncompressibleReplicaPayloadV1 } from "@/lib/trader/intelligence/forecast-v2/a3-incompressible-replica-payload-v1";
import {
  cleanupForecastV2StorageRows,
  insertA3FourCellPackageSurface,
} from "@/lib/trader/intelligence/forecast-v2/storage-scale-postgres-v1";
import { seedWp13User } from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const FIXTURE_USER = "00000000-0000-4000-8000-000000051846";

describe.skipIf(!integrationEnabled || !url)(
  "A3 incompressible package fixture TOAST proof",
  () => {
    let orgId: string;
    let sql: postgres.Sql;

    beforeAll(async () => {
      orgId = await seedWp13User(url!, FIXTURE_USER, "A3 incompressible fixture");
      sql = postgres(url!, { max: 2 });
      await cleanupForecastV2StorageRows(sql, orgId);
    }, 120_000);

    afterAll(async () => {
      if (sql && orgId) {
        await cleanupForecastV2StorageRows(sql, orgId);
      }
      await sql?.end({ timeout: 10 });
    });

    it("representative payloads stay near raw size (not ~762-byte TOAST collapse)", async () => {
      const payload = buildA3IncompressibleReplicaPayloadV1({
        symbol: "BTCUSDT",
        primaryHorizonMinutes: 30,
        replicaOrdinal: 0,
      });
      expect(payload.length).toBe(65_536);

      await insertA3FourCellPackageSurface(sql, orgId);
      await sql`VACUUM (ANALYZE) trader_forecast_replica_artifact_v2`;

      const rows = await sql<{ octet_length: string; pg_column_size: string }[]>`
        SELECT
          octet_length(artifact_payload)::text AS octet_length,
          pg_column_size(artifact_payload)::text AS pg_column_size
        FROM trader_forecast_replica_artifact_v2
        WHERE organization_id = ${orgId}::uuid
        ORDER BY replica_ordinal
        LIMIT 5
      `;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(Number(row.octet_length)).toBe(65_536);
        // Prior compressible fixture stored ~762 bytes; require >> 8 KiB physical.
        expect(Number(row.pg_column_size)).toBeGreaterThan(8_192);
      }
    });
  },
);
