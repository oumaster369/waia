import { and, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export function createPostgresTreasuryCatalogRepository(ex: PgExecutor): TreasuryCatalogRepository {
  return {
    async listWatchedAddresses(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryWatchedAddresses)
        .where(orgScopedWhere(pgSchema.treasuryWatchedAddresses.organizationId, org));
    },
    async getWatchedAddress(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryWatchedAddresses)
        .where(
          and(
            eq(pgSchema.treasuryWatchedAddresses.id, id),
            orgScopedWhere(pgSchema.treasuryWatchedAddresses.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertWatchedAddress(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryWatchedAddresses).values(record);
    },
    async updateWatchedAddress(context, id, patch) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryWatchedAddresses)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(pgSchema.treasuryWatchedAddresses.id, id),
            orgScopedWhere(pgSchema.treasuryWatchedAddresses.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("watched_address", id);
      return rows[0];
    },

    async listBudgets(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryBudgets)
        .where(orgScopedWhere(pgSchema.treasuryBudgets.organizationId, org));
    },
    async getBudget(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryBudgets)
        .where(
          and(
            eq(pgSchema.treasuryBudgets.id, id),
            orgScopedWhere(pgSchema.treasuryBudgets.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertBudget(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryBudgets).values(record);
    },
    async updateBudget(context, id, patch) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryBudgets)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(pgSchema.treasuryBudgets.id, id),
            orgScopedWhere(pgSchema.treasuryBudgets.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("budget", id);
      return rows[0];
    },

    async listFundingNeeds(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryFundingNeeds)
        .where(orgScopedWhere(pgSchema.treasuryFundingNeeds.organizationId, org));
    },
    async getFundingNeed(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryFundingNeeds)
        .where(
          and(
            eq(pgSchema.treasuryFundingNeeds.id, id),
            orgScopedWhere(pgSchema.treasuryFundingNeeds.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertFundingNeed(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryFundingNeeds).values(record);
    },
    async updateFundingNeed(context, id, patch) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryFundingNeeds)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(
            eq(pgSchema.treasuryFundingNeeds.id, id),
            orgScopedWhere(pgSchema.treasuryFundingNeeds.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("funding_need", id);
      return rows[0];
    },

    async listIdealBudgets(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryIdealAnnualBudgets)
        .where(orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org));
    },
    async getIdealBudget(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryIdealAnnualBudgets)
        .where(
          and(
            eq(pgSchema.treasuryIdealAnnualBudgets.id, id),
            orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async findActivePublicIdeal(context, periodYear) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryIdealAnnualBudgets)
        .where(
          and(
            orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org),
            eq(pgSchema.treasuryIdealAnnualBudgets.periodYear, periodYear),
            eq(pgSchema.treasuryIdealAnnualBudgets.status, "ACTIVE"),
            eq(pgSchema.treasuryIdealAnnualBudgets.publicationState, "PUBLIC"),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertIdealBudget(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryIdealAnnualBudgets).values(record);
    },
    async updateIdealBudget(context, id, patch) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryIdealAnnualBudgets)
        .set(patch)
        .where(
          and(
            eq(pgSchema.treasuryIdealAnnualBudgets.id, id),
            orgScopedWhere(pgSchema.treasuryIdealAnnualBudgets.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("ideal_budget", id);
      return rows[0];
    },

    async listRunwayPlans(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryRunwayPlans)
        .where(orgScopedWhere(pgSchema.treasuryRunwayPlans.organizationId, org));
    },
    async getRunwayPlan(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryRunwayPlans)
        .where(
          and(
            eq(pgSchema.treasuryRunwayPlans.id, id),
            orgScopedWhere(pgSchema.treasuryRunwayPlans.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertRunwayPlan(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryRunwayPlans).values(record);
    },
    async updateRunwayPlan(context, id, patch) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryRunwayPlans)
        .set(patch)
        .where(
          and(
            eq(pgSchema.treasuryRunwayPlans.id, id),
            orgScopedWhere(pgSchema.treasuryRunwayPlans.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("runway_plan", id);
      return rows[0];
    },

    async getPublicationSettings(context) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryPublicationSettings)
        .where(orgScopedWhere(pgSchema.treasuryPublicationSettings.organizationId, org))
        .limit(1);
      return rows[0] ?? null;
    },
    async upsertPublicationSettings(record) {
      requireOrgContext(record.organizationId);
      const existing = await this.getPublicationSettings({ organizationId: record.organizationId });
      if (existing) {
        await ex
          .update(pgSchema.treasuryPublicationSettings)
          .set(record)
          .where(eq(pgSchema.treasuryPublicationSettings.organizationId, record.organizationId));
        return;
      }
      await ex.insert(pgSchema.treasuryPublicationSettings).values(record);
    },

    async listEvidenceObjects(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryEvidenceObjects)
        .where(orgScopedWhere(pgSchema.treasuryEvidenceObjects.organizationId, org));
    },
    async getEvidenceObject(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryEvidenceObjects)
        .where(
          and(
            eq(pgSchema.treasuryEvidenceObjects.id, id),
            orgScopedWhere(pgSchema.treasuryEvidenceObjects.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertEvidenceObject(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryEvidenceObjects).values(record);
    },
    async updateEvidenceVisibility(context, id, visibility) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryEvidenceObjects)
        .set({ visibility })
        .where(
          and(
            eq(pgSchema.treasuryEvidenceObjects.id, id),
            orgScopedWhere(pgSchema.treasuryEvidenceObjects.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("evidence", id);
      return rows[0];
    },

    async listOrgAttributions(context) {
      const org = requireOrgContext(context.organizationId);
      return ex
        .select()
        .from(pgSchema.treasuryContributionAttributions)
        .where(orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org));
    },
    async getAttribution(context, id) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .select()
        .from(pgSchema.treasuryContributionAttributions)
        .where(
          and(
            eq(pgSchema.treasuryContributionAttributions.id, id),
            orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    async insertAdminAttribution(record) {
      requireOrgContext(record.organizationId);
      await ex.insert(pgSchema.treasuryContributionAttributions).values(record);
    },
    async updateAdminAttribution(context, id, patch) {
      const org = requireOrgContext(context.organizationId);
      const rows = await ex
        .update(pgSchema.treasuryContributionAttributions)
        .set(patch)
        .where(
          and(
            eq(pgSchema.treasuryContributionAttributions.id, id),
            orgScopedWhere(pgSchema.treasuryContributionAttributions.organizationId, org),
          ),
        )
        .returning();
      if (!rows[0]) throw new TreasuryNotFoundError("attribution", id);
      return rows[0];
    },
  };
}
