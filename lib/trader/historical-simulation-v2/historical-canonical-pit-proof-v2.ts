import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as pgSchema from "@/db/schema.postgres";
import { readCanonicalPitObservationWithinHeldTransactionV1Postgres } from
  "@/lib/trader/mi/canonical-pit-service-postgres";

/**
 * Historical-only adapter around the canonical PIT reader. Forecast V2 consumes
 * the verified result without acquiring Source/PIT/Trust construction authority.
 */
export async function readHistoricalCanonicalPitObservationV2(
  sql: postgres.Sql,
  scope: Readonly<{ organizationId: string }>,
  observationId: string,
) {
  return readCanonicalPitObservationWithinHeldTransactionV1Postgres(
    drizzle(sql, { schema: pgSchema }),
    scope,
    observationId,
  );
}
