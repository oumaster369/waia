import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type { ContributionShareFactsRepository } from "@/lib/waia-core/treasury/share/repository.types";
import type { ShareAttributionFact } from "@/lib/waia-core/treasury/share/types";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";

/**
 * Postgres contribution-share facts. Every query is org-scoped and unpaginated.
 * Do not add LIMIT/OFFSET to transaction or attribution loads.
 * Public aggregate uses `loadContributionFacts` only — it must not query
 * `treasury_contribution_attributions` or join users/profiles.
 */
export function createPostgresContributionShareFactsRepository(
  db: Pick<WaiaPostgresDb, "select">,
): ContributionShareFactsRepository {
  return {
    async loadContributionFacts(context) {
      const org = requireOrgContext(context.organizationId);
      const transactions = await db
        .select()
        .from(pgSchema.treasuryTransactions)
        .where(orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org));
      const mapped: TreasuryTransactionRecord[] = transactions.map((row) => ({ ...row }));
      return mapped;
    },

    async loadAttributionFacts(context) {
      const org = requireOrgContext(context.organizationId);
      const attributionRows = await db
        .select({
          id: pgSchema.treasuryContributionAttributions.id,
          organizationId: pgSchema.treasuryContributionAttributions.organizationId,
          transactionId: pgSchema.treasuryContributionAttributions.transactionId,
          status: pgSchema.treasuryContributionAttributions.status,
          contributorUserId: pgSchema.treasuryContributionAttributions.contributorUserId,
          revokedAt: pgSchema.treasuryContributionAttributions.revokedAt,
          createdAt: pgSchema.treasuryContributionAttributions.createdAt,
          attributedAt: pgSchema.treasuryContributionAttributions.attributedAt,
        })
        .from(pgSchema.treasuryContributionAttributions)
        .where(orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org));
      const attributions: ShareAttributionFact[] = attributionRows.map((row) => ({
        ...row,
        createdAt: row.createdAt,
        attributedAt: row.attributedAt,
      }));
      return attributions;
    },
  };
}
