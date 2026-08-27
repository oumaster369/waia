import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { and, eq, inArray } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { treasuryAuditActions, treasuryEntityTypes } from "@/lib/waia-core/treasury/audit";
import type {
  PublicTreasuryAttributionFact,
  PublicTreasuryFactsRepository,
  PublicTreasuryProfileFact,
} from "@/lib/waia-core/treasury/public/repository.types";

/**
 * Read-only, complete public Treasury facts. Every financial query is explicitly
 * organization-scoped and unpaginated. This repository exposes no mutation method.
 */
export function createPostgresPublicTreasuryFactsRepository(
  db: Pick<WaiaPostgresDb, "select">,
): PublicTreasuryFactsRepository {
  return {
    async loadFacts(context) {
      const org = requireOrgContext(context.organizationId);
      const [
        settingsRows,
        transactions,
        commitments,
        fundingNeeds,
        idealBudgets,
        runwayPlans,
        runwaySnapshots,
        reconciliations,
        inceptions,
        balanceCheckpoints,
        categories,
        categoryBudgetHistory,
        projects,
        attributionRows,
        profileRows,
        idealAuditFacts,
      ] = await Promise.all([
        db
          .select()
          .from(pgSchema.treasuryPublicationSettings)
          .where(orgScopedWhere(pgSchema.treasuryPublicationSettings.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryTransactions)
          .where(orgScopedWhere(pgSchema.treasuryTransactions.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryCommitments)
          .where(orgScopedWhere(pgSchema.treasuryCommitments.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryFundingNeeds)
          .where(orgScopedWhere(pgSchema.treasuryFundingNeeds.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryIdealAnnualBudgets)
          .where(orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryRunwayPlans)
          .where(orgScopedWhere(pgSchema.treasuryRunwayPlans.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryRunwaySnapshots)
          .where(orgScopedWhere(pgSchema.treasuryRunwaySnapshots.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryBalanceReconciliations)
          .where(orgScopedWhere(pgSchema.treasuryBalanceReconciliations.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryLedgerInceptions)
          .where(orgScopedWhere(pgSchema.treasuryLedgerInceptions.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryBalanceCheckpoints)
          .where(orgScopedWhere(pgSchema.treasuryBalanceCheckpoints.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryCategories)
          .where(orgScopedWhere(pgSchema.treasuryCategories.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryCategoryBudgetHistory)
          .where(orgScopedWhere(pgSchema.treasuryCategoryBudgetHistory.organizationId, org)),
        db
          .select()
          .from(pgSchema.treasuryProjects)
          .where(orgScopedWhere(pgSchema.treasuryProjects.organizationId, org)),
        db
          .select({
            id: pgSchema.treasuryContributionAttributions.id,
            organizationId: pgSchema.treasuryContributionAttributions.organizationId,
            transactionId: pgSchema.treasuryContributionAttributions.transactionId,
            status: pgSchema.treasuryContributionAttributions.status,
            contributorUserId: pgSchema.treasuryContributionAttributions.contributorUserId,
            consentPublicIdentity: pgSchema.treasuryContributionAttributions.consentPublicIdentity,
            publicSiteUrl: pgSchema.treasuryContributionAttributions.publicSiteUrl,
            twinProfileUrl: pgSchema.treasuryContributionAttributions.twinProfileUrl,
            createdAt: pgSchema.treasuryContributionAttributions.createdAt,
            attributedAt: pgSchema.treasuryContributionAttributions.attributedAt,
            revokedAt: pgSchema.treasuryContributionAttributions.revokedAt,
          })
          .from(pgSchema.treasuryContributionAttributions)
          .where(orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org)),
        db
          .select({
            userId: pgSchema.profiles.userId,
            displayName: pgSchema.profiles.displayName,
            updatedAt: pgSchema.profiles.updatedAt,
          })
          .from(pgSchema.treasuryContributionAttributions)
          .innerJoin(
            pgSchema.profiles,
            eq(
              pgSchema.treasuryContributionAttributions.contributorUserId,
              pgSchema.profiles.userId,
            ),
          )
          .where(orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org)),
        db
          .select({
            entityId: pgSchema.auditLogs.entityId,
            createdAt: pgSchema.auditLogs.createdAt,
          })
          .from(pgSchema.auditLogs)
          .where(
            and(
              orgScopedWhere(pgSchema.auditLogs.organizationId, org),
              eq(pgSchema.auditLogs.entityType, treasuryEntityTypes.idealBudget),
              inArray(pgSchema.auditLogs.action, [
                treasuryAuditActions.idealBudgetCreate,
                treasuryAuditActions.idealBudgetPublish,
              ]),
            ),
          ),
      ]);

      const attributions: PublicTreasuryAttributionFact[] = attributionRows.map((row) => ({
        ...row,
      }));
      const profiles: PublicTreasuryProfileFact[] = profileRows.map((row) => ({ ...row }));

      return {
        organizationId: org.organizationId,
        settings: settingsRows[0] ?? null,
        transactions,
        commitments,
        fundingNeeds,
        idealBudgets,
        runwayPlans,
        runwaySnapshots,
        reconciliations,
        inceptions,
        balanceCheckpoints: balanceCheckpoints.map((row) => ({
          ...row,
          sourceLabel: "HUMAN_CONFIRMED" as const,
        })),
        categories,
        categoryBudgetHistory,
        projects,
        attributions,
        profiles,
        idealAuditFacts: idealAuditFacts.flatMap((row) =>
          row.entityId ? [{ entityId: row.entityId, createdAt: row.createdAt }] : [],
        ),
      };
    },
  };
}
