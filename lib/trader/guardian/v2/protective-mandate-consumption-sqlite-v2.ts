import { traderGuardianProtectiveConsumptionsV2 } from "@/db/schema";
import type { WaiaDb } from "@/db/types";

import type { ProtectiveMandateConsumptionRepositoryV2 } from "./protective-mandate-consumption-v2";

export function createSqliteProtectiveMandateConsumptionRepositoryV2(
  db: WaiaDb,
): ProtectiveMandateConsumptionRepositoryV2 {
  return {
    async claimOnce(value) {
      const inserted = await db.insert(traderGuardianProtectiveConsumptionsV2).values({
        contentDigest: value.contentDigest,
        organizationId: value.organizationId,
        mandateId: value.mandateId,
        mandateContentDigest: value.mandateContentDigest,
        triggerProofContentDigest: value.triggerProofContentDigest,
        adjudicatedAtUtc: value.adjudicatedAtUtc,
      }).onConflictDoNothing().returning({ contentDigest: traderGuardianProtectiveConsumptionsV2.contentDigest });
      return inserted.length === 1 ? "CLAIMED" : "ALREADY_CONSUMED";
    },
  };
}
