import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";

import type { ProtectiveMandateConsumptionRepositoryV2 } from "./protective-mandate-consumption-v2";

type Executor = Pick<WaiaPostgresDb, "insert">;

export function createPostgresProtectiveMandateConsumptionRepositoryV2(
  db: Executor,
): ProtectiveMandateConsumptionRepositoryV2 {
  return {
    async claimOnce(value) {
      const inserted = await db.insert(pgSchema.traderGuardianProtectiveConsumptionsV2).values({
        contentDigest: value.contentDigest,
        organizationId: value.organizationId,
        mandateId: value.mandateId,
        mandateContentDigest: value.mandateContentDigest,
        triggerProofContentDigest: value.triggerProofContentDigest,
        adjudicatedAtUtc: value.adjudicatedAtUtc,
      }).onConflictDoNothing().returning({ contentDigest: pgSchema.traderGuardianProtectiveConsumptionsV2.contentDigest });
      return inserted.length === 1 ? "CLAIMED" : "ALREADY_CONSUMED";
    },
  };
}
