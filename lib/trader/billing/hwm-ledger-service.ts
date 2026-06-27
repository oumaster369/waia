import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  HwmLedgerAlreadyBootstrappedError,
  HwmLedgerNotBootstrappedError,
  HwmLedgerRatchetNotAllowedError,
  HwmLedgerRollbackReasonRequiredError,
} from "@/lib/trader/billing/hwm-ledger.errors";
import type {
  HwmLedgerRepository,
  ListHwmLedgerQuery,
} from "@/lib/trader/billing/hwm-ledger-repository.types";
import {
  createPostgresHwmLedgerRepository,
  createSqliteHwmLedgerRepository,
} from "@/lib/trader/billing/hwm-ledger-repository-adapters";
import type { HwmLedgerRecordView } from "@/lib/trader/billing/hwm-ledger.types";
import { buildHwmLedgerRecordPayload } from "@/lib/trader/billing/serialize-hwm-ledger";
import { compareDecimal } from "@/lib/trader/risk/numeric";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgHwmLedgerExecutor = Pick<WaiaPostgresDb, "select" | "insert">;

export type BootstrapHwmInput = {
  exchangeAccountId: string;
  initialHwm: string;
  valuationSource: string;
  effectiveAt: Date;
  sourcePeriodId?: string | null;
};

export type RecordHwmRatchetInput = {
  exchangeAccountId: string;
  newHwm: string;
  sourcePeriodId: string | null;
  sourceInvoiceId?: string | null;
  valuationSource: string;
  effectiveAt: Date;
};

export type RecordHwmRollbackInput = {
  exchangeAccountId: string;
  restoredHwm: string;
  sourcePeriodId: string | null;
  reason: string;
  effectiveAt: Date;
};

export type HwmLedgerServiceDeps = {
  repository: HwmLedgerRepository;
  writeAudit: (input: TraderAuditInput) => string | Promise<string>;
  assertMembership?: (context: OrgContext & { userId: string }) => void | Promise<void>;
};

export type HwmLedgerService = {
  bootstrapHwm(context: OrgContext, input: BootstrapHwmInput): Promise<HwmLedgerRecordView>;
  getCurrentHwm(
    context: OrgContext,
    exchangeAccountId: string,
  ): Promise<HwmLedgerRecordView | null>;
  recordHwmRatchet(context: OrgContext, input: RecordHwmRatchetInput): Promise<HwmLedgerRecordView>;
  recordHwmRollback(
    context: OrgContext,
    input: RecordHwmRollbackInput,
  ): Promise<HwmLedgerRecordView>;
  listHwmLedger(context: OrgContext, query?: ListHwmLedgerQuery): Promise<HwmLedgerRecordView[]>;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: HwmLedgerServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function buildAuditInput(
  action: TraderAuditInput["action"],
  context: OrgContext,
  entityId: string,
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action,
    entityType: traderEntityTypes.hwmLedger,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

export function createHwmLedgerService(deps: HwmLedgerServiceDeps): HwmLedgerService {
  return {
    async bootstrapHwm(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const existing = await deps.repository.findBootstrapEntry(scoped, input.exchangeAccountId);
      if (existing) {
        throw new HwmLedgerAlreadyBootstrappedError(input.exchangeAccountId);
      }

      const payload = buildHwmLedgerRecordPayload({
        organizationId: scoped.organizationId,
        exchangeAccountId: input.exchangeAccountId,
        entryType: "BOOTSTRAP",
        highWaterMark: input.initialHwm,
        previousHighWaterMark: null,
        sourcePeriodId: input.sourcePeriodId ?? null,
        sourceInvoiceId: null,
        valuationSource: input.valuationSource,
        effectiveAt: input.effectiveAt,
        reason: null,
      });

      const row = await deps.repository.insertEntry(scoped, { payload });

      await deps.writeAudit(
        buildAuditInput(traderAuditActions.hwmBootstrapped, scoped, row.id, {
          exchangeAccountId: input.exchangeAccountId,
          highWaterMark: input.initialHwm,
          valuationSource: input.valuationSource,
          effectiveAt: input.effectiveAt.toISOString(),
          sourcePeriodId: input.sourcePeriodId ?? null,
          recordContentDigest: row.recordContentDigest,
        }),
      );

      return row;
    },

    async getCurrentHwm(context, exchangeAccountId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.repository.getCurrentEntry(scoped, exchangeAccountId);
    },

    async recordHwmRatchet(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const current = await deps.repository.getCurrentEntry(scoped, input.exchangeAccountId);
      if (!current) {
        throw new HwmLedgerNotBootstrappedError(input.exchangeAccountId);
      }

      if (compareDecimal(input.newHwm, current.highWaterMark) <= 0) {
        throw new HwmLedgerRatchetNotAllowedError(
          input.exchangeAccountId,
          input.newHwm,
          current.highWaterMark,
        );
      }

      const payload = buildHwmLedgerRecordPayload({
        organizationId: scoped.organizationId,
        exchangeAccountId: input.exchangeAccountId,
        entryType: "RATCHET_UP",
        highWaterMark: input.newHwm,
        previousHighWaterMark: current.highWaterMark,
        sourcePeriodId: input.sourcePeriodId,
        sourceInvoiceId: input.sourceInvoiceId ?? null,
        valuationSource: input.valuationSource,
        effectiveAt: input.effectiveAt,
        reason: null,
      });

      const row = await deps.repository.insertEntry(scoped, { payload });

      await deps.writeAudit(
        buildAuditInput(traderAuditActions.hwmRatcheted, scoped, row.id, {
          exchangeAccountId: input.exchangeAccountId,
          highWaterMark: input.newHwm,
          previousHighWaterMark: current.highWaterMark,
          sourcePeriodId: input.sourcePeriodId,
          sourceInvoiceId: input.sourceInvoiceId ?? null,
          valuationSource: input.valuationSource,
          effectiveAt: input.effectiveAt.toISOString(),
          recordContentDigest: row.recordContentDigest,
        }),
      );

      return row;
    },

    async recordHwmRollback(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      if (!input.reason.trim()) {
        throw new HwmLedgerRollbackReasonRequiredError();
      }

      const current = await deps.repository.getCurrentEntry(scoped, input.exchangeAccountId);
      if (!current) {
        throw new HwmLedgerNotBootstrappedError(input.exchangeAccountId);
      }

      const payload = buildHwmLedgerRecordPayload({
        organizationId: scoped.organizationId,
        exchangeAccountId: input.exchangeAccountId,
        entryType: "ROLLBACK",
        highWaterMark: input.restoredHwm,
        previousHighWaterMark: current.highWaterMark,
        sourcePeriodId: input.sourcePeriodId,
        sourceInvoiceId: null,
        valuationSource: current.valuationSource,
        effectiveAt: input.effectiveAt,
        reason: input.reason.trim(),
      });

      const row = await deps.repository.insertEntry(scoped, { payload });

      await deps.writeAudit(
        buildAuditInput(traderAuditActions.hwmRolledBack, scoped, row.id, {
          exchangeAccountId: input.exchangeAccountId,
          highWaterMark: input.restoredHwm,
          previousHighWaterMark: current.highWaterMark,
          sourcePeriodId: input.sourcePeriodId,
          reason: input.reason.trim(),
          effectiveAt: input.effectiveAt.toISOString(),
          recordContentDigest: row.recordContentDigest,
        }),
      );

      return row;
    },

    async listHwmLedger(context, query = {}) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return deps.repository.listEntries(scoped, query);
    },
  };
}

export function createSqliteHwmLedgerService(
  db: WaiaDb,
  deps: Partial<HwmLedgerServiceDeps> = {},
): HwmLedgerService {
  return createHwmLedgerService({
    repository: deps.repository ?? createSqliteHwmLedgerRepository(db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogSqlite(db, input)),
    assertMembership:
      deps.assertMembership ??
      ((context) => {
        assertOrgMembershipSqlite(db, context);
      }),
  });
}

export function createPostgresHwmLedgerService(
  ex: PgHwmLedgerExecutor,
  deps: Partial<HwmLedgerServiceDeps> = {},
  db?: WaiaPostgresDb,
): HwmLedgerService {
  return createHwmLedgerService({
    repository: deps.repository ?? createPostgresHwmLedgerRepository(ex, db),
    writeAudit: deps.writeAudit ?? ((input) => writeTraderAuditLogPostgres(ex, input)),
    assertMembership:
      deps.assertMembership ??
      (async (context) => {
        await assertOrgMembershipPostgres(ex, context);
      }),
  });
}
