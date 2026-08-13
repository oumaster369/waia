import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { TreasuryNotFoundError, TreasuryOrgScopeError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
import type {
  TreasuryAdminAttribution,
  TreasuryBudgetRecord,
  TreasuryEvidenceObjectRecord,
  TreasuryFundingNeedRecord,
  TreasuryIdealBudgetRecord,
  TreasuryPublicationSettingsRecord,
  TreasuryRunwayPlanRecord,
} from "@/lib/waia-core/treasury/admin/catalog-types";
import type { TreasuryWatchedAddressRecord } from "@/lib/waia-core/treasury/watcher/types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function scopedId(organizationId: string, id: string): string {
  return `${organizationId}:${id}`;
}

function requireScope(context: OrgContext): OrgContext {
  const scoped = requireOrgContext(context.organizationId);
  if (!scoped.organizationId) throw new TreasuryOrgScopeError();
  return scoped;
}

export function createMemoryTreasuryCatalogRepository(): TreasuryCatalogRepository {
  const addresses = new Map<string, TreasuryWatchedAddressRecord>();
  const budgets = new Map<string, TreasuryBudgetRecord>();
  const needs = new Map<string, TreasuryFundingNeedRecord>();
  const ideals = new Map<string, TreasuryIdealBudgetRecord>();
  const runways = new Map<string, TreasuryRunwayPlanRecord>();
  const settings = new Map<string, TreasuryPublicationSettingsRecord>();
  const evidence = new Map<string, TreasuryEvidenceObjectRecord>();
  const attributions = new Map<string, TreasuryAdminAttribution>();

  return {
    async listWatchedAddresses(context) {
      const scoped = requireScope(context);
      return [...addresses.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getWatchedAddress(context, id) {
      const scoped = requireScope(context);
      const row = addresses.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async insertWatchedAddress(record) {
      requireOrgContext(record.organizationId);
      addresses.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateWatchedAddress(context, id, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = addresses.get(key);
      if (!existing) throw new TreasuryNotFoundError("watched_address", id);
      const next = { ...existing, ...patch, updatedAt: new Date() };
      addresses.set(key, next);
      return clone(next);
    },

    async listBudgets(context) {
      const scoped = requireScope(context);
      return [...budgets.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getBudget(context, id) {
      const scoped = requireScope(context);
      const row = budgets.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async insertBudget(record) {
      requireOrgContext(record.organizationId);
      budgets.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateBudget(context, id, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = budgets.get(key);
      if (!existing) throw new TreasuryNotFoundError("budget", id);
      const next = { ...existing, ...patch, updatedAt: new Date() };
      budgets.set(key, next);
      return clone(next);
    },

    async listFundingNeeds(context) {
      const scoped = requireScope(context);
      return [...needs.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getFundingNeed(context, id) {
      const scoped = requireScope(context);
      const row = needs.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async insertFundingNeed(record) {
      requireOrgContext(record.organizationId);
      needs.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateFundingNeed(context, id, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = needs.get(key);
      if (!existing) throw new TreasuryNotFoundError("funding_need", id);
      const next = { ...existing, ...patch, updatedAt: new Date() };
      needs.set(key, next);
      return clone(next);
    },

    async listIdealBudgets(context) {
      const scoped = requireScope(context);
      return [...ideals.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getIdealBudget(context, id) {
      const scoped = requireScope(context);
      const row = ideals.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async findActivePublicIdeal(context, periodYear) {
      const scoped = requireScope(context);
      const row = [...ideals.values()].find(
        (item) =>
          item.organizationId === scoped.organizationId &&
          item.periodYear === periodYear &&
          item.status === "ACTIVE" &&
          item.publicationState === "PUBLIC",
      );
      return row ? clone(row) : null;
    },
    async insertIdealBudget(record) {
      requireOrgContext(record.organizationId);
      ideals.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateIdealBudget(context, id, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = ideals.get(key);
      if (!existing) throw new TreasuryNotFoundError("ideal_budget", id);
      const next = { ...existing, ...patch };
      ideals.set(key, next);
      return clone(next);
    },

    async listRunwayPlans(context) {
      const scoped = requireScope(context);
      return [...runways.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getRunwayPlan(context, id) {
      const scoped = requireScope(context);
      const row = runways.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async insertRunwayPlan(record) {
      requireOrgContext(record.organizationId);
      runways.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateRunwayPlan(context, id, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = runways.get(key);
      if (!existing) throw new TreasuryNotFoundError("runway_plan", id);
      const next = { ...existing, ...patch };
      runways.set(key, next);
      return clone(next);
    },

    async getPublicationSettings(context) {
      const scoped = requireScope(context);
      const row = settings.get(scoped.organizationId);
      return row ? clone(row) : null;
    },
    async upsertPublicationSettings(record) {
      requireOrgContext(record.organizationId);
      settings.set(record.organizationId, clone(record));
    },

    async listEvidenceObjects(context) {
      const scoped = requireScope(context);
      return [...evidence.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getEvidenceObject(context, id) {
      const scoped = requireScope(context);
      const row = evidence.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async insertEvidenceObject(record) {
      requireOrgContext(record.organizationId);
      evidence.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateEvidenceVisibility(context, id, visibility) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = evidence.get(key);
      if (!existing) throw new TreasuryNotFoundError("evidence", id);
      const next = { ...existing, visibility };
      evidence.set(key, next);
      return clone(next);
    },

    async listOrgAttributions(context) {
      const scoped = requireScope(context);
      return [...attributions.values()]
        .filter((row) => row.organizationId === scoped.organizationId)
        .map(clone);
    },
    async getAttribution(context, id) {
      const scoped = requireScope(context);
      const row = attributions.get(scopedId(scoped.organizationId, id));
      return row ? clone(row) : null;
    },
    async insertAdminAttribution(record) {
      requireOrgContext(record.organizationId);
      attributions.set(scopedId(record.organizationId, record.id), clone(record));
    },
    async updateAdminAttribution(context, id, patch) {
      const scoped = requireScope(context);
      const key = scopedId(scoped.organizationId, id);
      const existing = attributions.get(key);
      if (!existing) throw new TreasuryNotFoundError("attribution", id);
      const next = { ...existing, ...patch };
      attributions.set(key, next);
      return clone(next);
    },
  };
}
