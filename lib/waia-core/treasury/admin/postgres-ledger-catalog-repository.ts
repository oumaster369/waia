import { and, asc, eq, gt, ilike, or } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { orgScopedWhere, requireOrgContext } from "@/lib/waia-core/scope/org-context";
import type { TreasuryLedgerCatalogRepository } from "@/lib/waia-core/treasury/admin/ledger-catalog-repository.types";
import type { TreasuryLedgerCatalogQuery } from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import { TreasuryNotFoundError } from "@/lib/waia-core/treasury/errors";

type PgExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

function boundedLimit(query: TreasuryLedgerCatalogQuery): number {
  return Math.min(Math.max(query.limit ?? 50, 1), 100) + 1;
}

export function createPostgresTreasuryLedgerCatalogRepository(
  ex: PgExecutor,
): TreasuryLedgerCatalogRepository {
  return {
    counterparties: {
      async list(context, query) {
        const org = requireOrgContext(context.organizationId);
        return ex
          .select()
          .from(pgSchema.treasuryCounterparties)
          .where(
            and(
              orgScopedWhere(pgSchema.treasuryCounterparties.organizationId, org),
              query.active === undefined
                ? undefined
                : eq(pgSchema.treasuryCounterparties.isActive, query.active),
              query.q?.trim()
                ? ilike(pgSchema.treasuryCounterparties.displayName, `%${query.q.trim()}%`)
                : undefined,
              query.afterName && query.afterId
                ? or(
                    gt(pgSchema.treasuryCounterparties.displayName, query.afterName),
                    and(
                      eq(pgSchema.treasuryCounterparties.displayName, query.afterName),
                      gt(pgSchema.treasuryCounterparties.id, query.afterId),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(
            asc(pgSchema.treasuryCounterparties.displayName),
            asc(pgSchema.treasuryCounterparties.id),
          )
          .limit(boundedLimit(query));
      },
      async get(context, id) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .select()
          .from(pgSchema.treasuryCounterparties)
          .where(
            and(
              eq(pgSchema.treasuryCounterparties.id, id),
              orgScopedWhere(pgSchema.treasuryCounterparties.organizationId, org),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      async findByWaiaUserId(context, waiaUserId) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .select()
          .from(pgSchema.treasuryCounterparties)
          .where(
            and(
              eq(pgSchema.treasuryCounterparties.waiaUserId, waiaUserId),
              orgScopedWhere(pgSchema.treasuryCounterparties.organizationId, org),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(record) {
        requireOrgContext(record.organizationId);
        await ex.insert(pgSchema.treasuryCounterparties).values(record);
      },
      async update(context, id, patch) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .update(pgSchema.treasuryCounterparties)
          .set({
            ...patch,
            id: undefined,
            organizationId: undefined,
            createdAt: undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pgSchema.treasuryCounterparties.id, id),
              orgScopedWhere(pgSchema.treasuryCounterparties.organizationId, org),
            ),
          )
          .returning();
        if (!rows[0]) throw new TreasuryNotFoundError("counterparty", id);
        return rows[0];
      },
    },
    accounts: {
      async list(context, query) {
        const org = requireOrgContext(context.organizationId);
        return ex
          .select()
          .from(pgSchema.treasuryAccounts)
          .where(
            and(
              orgScopedWhere(pgSchema.treasuryAccounts.organizationId, org),
              query.active === undefined
                ? undefined
                : eq(pgSchema.treasuryAccounts.isActive, query.active),
              query.q?.trim()
                ? ilike(pgSchema.treasuryAccounts.displayName, `%${query.q.trim()}%`)
                : undefined,
              query.afterName && query.afterId
                ? or(
                    gt(pgSchema.treasuryAccounts.displayName, query.afterName),
                    and(
                      eq(pgSchema.treasuryAccounts.displayName, query.afterName),
                      gt(pgSchema.treasuryAccounts.id, query.afterId),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(pgSchema.treasuryAccounts.displayName), asc(pgSchema.treasuryAccounts.id))
          .limit(boundedLimit(query));
      },
      async get(context, id) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .select()
          .from(pgSchema.treasuryAccounts)
          .where(
            and(
              eq(pgSchema.treasuryAccounts.id, id),
              orgScopedWhere(pgSchema.treasuryAccounts.organizationId, org),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(record) {
        requireOrgContext(record.organizationId);
        await ex.insert(pgSchema.treasuryAccounts).values(record);
      },
      async update(context, id, patch) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .update(pgSchema.treasuryAccounts)
          .set({
            ...patch,
            id: undefined,
            organizationId: undefined,
            createdAt: undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pgSchema.treasuryAccounts.id, id),
              orgScopedWhere(pgSchema.treasuryAccounts.organizationId, org),
            ),
          )
          .returning();
        if (!rows[0]) throw new TreasuryNotFoundError("account", id);
        return rows[0];
      },
    },
    categories: {
      async list(context, query) {
        const org = requireOrgContext(context.organizationId);
        return ex
          .select()
          .from(pgSchema.treasuryCategories)
          .where(
            and(
              orgScopedWhere(pgSchema.treasuryCategories.organizationId, org),
              query.active === undefined
                ? undefined
                : eq(pgSchema.treasuryCategories.isActive, query.active),
              query.q?.trim()
                ? or(
                    ilike(pgSchema.treasuryCategories.name, `%${query.q.trim()}%`),
                    ilike(pgSchema.treasuryCategories.code, `%${query.q.trim()}%`),
                  )
                : undefined,
              query.afterName && query.afterId
                ? or(
                    gt(pgSchema.treasuryCategories.name, query.afterName),
                    and(
                      eq(pgSchema.treasuryCategories.name, query.afterName),
                      gt(pgSchema.treasuryCategories.id, query.afterId),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(pgSchema.treasuryCategories.name), asc(pgSchema.treasuryCategories.id))
          .limit(boundedLimit(query));
      },
      async get(context, id) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .select()
          .from(pgSchema.treasuryCategories)
          .where(
            and(
              eq(pgSchema.treasuryCategories.id, id),
              orgScopedWhere(pgSchema.treasuryCategories.organizationId, org),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(record) {
        requireOrgContext(record.organizationId);
        await ex.insert(pgSchema.treasuryCategories).values(record);
      },
      async update(context, id, patch) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .update(pgSchema.treasuryCategories)
          .set({
            ...patch,
            id: undefined,
            organizationId: undefined,
            createdAt: undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pgSchema.treasuryCategories.id, id),
              orgScopedWhere(pgSchema.treasuryCategories.organizationId, org),
            ),
          )
          .returning();
        if (!rows[0]) throw new TreasuryNotFoundError("category", id);
        return rows[0];
      },
    },
    projects: {
      async list(context, query) {
        const org = requireOrgContext(context.organizationId);
        return ex
          .select()
          .from(pgSchema.treasuryProjects)
          .where(
            and(
              orgScopedWhere(pgSchema.treasuryProjects.organizationId, org),
              query.active === undefined
                ? undefined
                : eq(pgSchema.treasuryProjects.isActive, query.active),
              query.q?.trim()
                ? ilike(pgSchema.treasuryProjects.name, `%${query.q.trim()}%`)
                : undefined,
              query.afterName && query.afterId
                ? or(
                    gt(pgSchema.treasuryProjects.name, query.afterName),
                    and(
                      eq(pgSchema.treasuryProjects.name, query.afterName),
                      gt(pgSchema.treasuryProjects.id, query.afterId),
                    ),
                  )
                : undefined,
            ),
          )
          .orderBy(asc(pgSchema.treasuryProjects.name), asc(pgSchema.treasuryProjects.id))
          .limit(boundedLimit(query));
      },
      async get(context, id) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .select()
          .from(pgSchema.treasuryProjects)
          .where(
            and(
              eq(pgSchema.treasuryProjects.id, id),
              orgScopedWhere(pgSchema.treasuryProjects.organizationId, org),
            ),
          )
          .limit(1);
        return rows[0] ?? null;
      },
      async insert(record) {
        requireOrgContext(record.organizationId);
        await ex.insert(pgSchema.treasuryProjects).values(record);
      },
      async update(context, id, patch) {
        const org = requireOrgContext(context.organizationId);
        const rows = await ex
          .update(pgSchema.treasuryProjects)
          .set({
            ...patch,
            id: undefined,
            organizationId: undefined,
            createdAt: undefined,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pgSchema.treasuryProjects.id, id),
              orgScopedWhere(pgSchema.treasuryProjects.organizationId, org),
            ),
          )
          .returning();
        if (!rows[0]) throw new TreasuryNotFoundError("project", id);
        return rows[0];
      },
    },
  };
}
