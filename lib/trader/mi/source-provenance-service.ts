import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { writeTraderAuditLogPostgres, writeTraderAuditLogSqlite } from "@/lib/trader/audit/write";
import {
  MiSourceDuplicateError,
  MiSourceNotFoundError,
  PitViolationError,
} from "@/lib/trader/mi/errors";
import type { MiSourceIdentity } from "@/lib/trader/mi/mi-source.types";
import { normalizeTrustScore } from "@/lib/trader/mi/normalize-trust-score";
import {
  createPostgresMiSourceProvenanceRepository,
  createSqliteMiSourceProvenanceRepository,
} from "@/lib/trader/mi/repository-adapters";
import {
  buildSourceTrustDigestInput,
  computeSourceTrustDigest,
} from "@/lib/trader/mi/serialize-source-trust";
import type { TrustRevision } from "@/lib/trader/mi/source-trust.types";
import type {
  AppendTrustRevisionServiceInput,
  CreateSourceServiceInput,
  MiSourceProvenanceRepository,
  MiSourceProvenanceServiceDeps,
  SetSourceStatusInput,
} from "@/lib/trader/mi/types";
import { traderAuditActions, traderEntityTypes, type TraderAuditInput } from "@/lib/trader/types";
import {
  assertOrgMembershipPostgres,
  assertOrgMembershipSqlite,
  requireOrgContext,
  type OrgContext,
} from "@/lib/waia-core/scope/org-context";

type PgMiServiceExecutor = Pick<WaiaPostgresDb, "select" | "insert" | "update">;

export type MiSourceProvenanceService = {
  createSource: (context: OrgContext, input: CreateSourceServiceInput) => Promise<MiSourceIdentity>;
  setSourceStatus: (
    context: OrgContext,
    sourceId: string,
    input: SetSourceStatusInput,
  ) => Promise<MiSourceIdentity>;
  appendTrustRevision: (
    context: OrgContext,
    input: AppendTrustRevisionServiceInput,
  ) => Promise<TrustRevision>;
  getCurrentTrust: (context: OrgContext, sourceId: string) => Promise<TrustRevision | null>;
  getTrustHistory: (context: OrgContext, sourceId: string) => Promise<TrustRevision[]>;
  listSources: (context: OrgContext) => Promise<MiSourceIdentity[]>;
};

async function assertMembershipIfNeeded(
  context: OrgContext,
  assertMembership: MiSourceProvenanceServiceDeps["assertMembership"],
): Promise<void> {
  if (context.userId && assertMembership) {
    await assertMembership({ organizationId: context.organizationId, userId: context.userId });
  }
}

function normalizeSymbol(symbol: string | null | undefined): string | null {
  if (symbol === undefined || symbol === null) {
    return null;
  }
  const trimmed = symbol.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildAuditInput(
  context: OrgContext,
  entityType: TraderAuditInput["entityType"],
  entityId: string,
  action: TraderAuditInput["action"],
  metadata: Record<string, unknown>,
  actorType: TraderAuditInput["actorType"] = "service",
  actorId: string | null = null,
): TraderAuditInput {
  return {
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    organizationId: context.organizationId,
    metadata,
  };
}

function createService(
  repo: MiSourceProvenanceRepository,
  deps: MiSourceProvenanceServiceDeps,
  writeAudit: (input: TraderAuditInput) => Promise<string> | string,
): MiSourceProvenanceService {
  return {
    async createSource(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const venue = input.venue.trim();
      const feedKind = input.feedKind.trim();
      const symbol = normalizeSymbol(input.symbol);
      const status = input.status ?? "active";
      const now = new Date();

      const existing = await repo.findSourceByLogicalKey(scoped, venue, feedKind, symbol);
      if (existing) {
        throw new MiSourceDuplicateError();
      }

      const id = crypto.randomUUID();
      const source = await repo.insertSource(scoped, input, id, now);

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miSource,
          source.id,
          traderAuditActions.miSourceCreated,
          { venue, feedKind, symbol, status },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return source;
    },

    async setSourceStatus(context, sourceId, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const existing = await repo.getSourceById(scoped, sourceId);
      if (!existing) {
        throw new MiSourceNotFoundError();
      }

      const now = new Date();
      const updated = await repo.updateSourceStatus(scoped, sourceId, input.status, now);
      if (!updated) {
        throw new MiSourceNotFoundError();
      }

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miSource,
          updated.id,
          traderAuditActions.miSourceStatusChanged,
          { from: existing.status, to: input.status },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return updated;
    },

    async appendTrustRevision(context, input) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);

      const source = await repo.getSourceById(scoped, input.sourceId);
      if (!source) {
        throw new MiSourceNotFoundError();
      }

      if (input.ingestTime.getTime() < input.eventTime.getTime()) {
        throw new PitViolationError();
      }

      const trustScore = normalizeTrustScore(input.trustScore);
      const latest = await repo.getLatestTrustRevision(scoped, input.sourceId);
      const revisionSeq = latest ? latest.revisionSeq + 1 : 1;
      const revisionOf = latest?.id ?? null;

      if (latest && revisionOf) {
        if (latest.sourceId !== input.sourceId || latest.revisionSeq !== revisionSeq - 1) {
          throw new Error("MI_TRUST_REVISION_CHAIN_INVALID");
        }
      }

      const digestInput = buildSourceTrustDigestInput({
        organizationId: scoped.organizationId,
        sourceId: input.sourceId,
        trustScore,
        rationale: input.rationale,
        recordedBy: input.recordedBy,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        revisionOf,
        revisionSeq,
      });
      const contentDigest = computeSourceTrustDigest(digestInput);

      const id = crypto.randomUUID();
      const now = new Date();
      const revision = await repo.insertTrustRevision(scoped, {
        id,
        sourceId: input.sourceId,
        trustScore,
        rationale: input.rationale,
        recordedBy: input.recordedBy,
        eventTime: input.eventTime,
        ingestTime: input.ingestTime,
        revisionOf,
        revisionSeq,
        contentDigest,
        createdAt: now,
      });

      writeAudit(
        buildAuditInput(
          scoped,
          traderEntityTypes.miSourceTrust,
          revision.id,
          traderAuditActions.miSourceTrustAppended,
          {
            sourceId: revision.sourceId,
            revisionSeq: revision.revisionSeq,
            revisionOf: revision.revisionOf,
            trustScore: revision.trustScore,
            contentDigest: revision.contentDigest,
          },
          input.actorType ?? deps.actorType ?? "service",
          input.actorId ?? deps.actorId ?? null,
        ),
      );

      return revision;
    },

    async getCurrentTrust(context, sourceId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.getLatestTrustRevision(scoped, sourceId);
    },

    async getTrustHistory(context, sourceId) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listTrustHistory(scoped, sourceId);
    },

    async listSources(context) {
      const scoped = requireOrgContext(context.organizationId);
      await assertMembershipIfNeeded(scoped, deps.assertMembership);
      return repo.listSources(scoped);
    },
  };
}

export function createSqliteMiSourceProvenanceService(
  db: WaiaDb,
  deps: MiSourceProvenanceServiceDeps = {},
): MiSourceProvenanceService {
  const repo = createSqliteMiSourceProvenanceRepository(db);
  return createService(repo, deps, (input) => writeTraderAuditLogSqlite(db, input));
}

export function createPostgresMiSourceProvenanceService(
  ex: PgMiServiceExecutor,
  deps: MiSourceProvenanceServiceDeps = {},
): MiSourceProvenanceService {
  const repo = createPostgresMiSourceProvenanceRepository(ex);
  return createService(repo, deps, (input) => writeTraderAuditLogPostgres(ex, input));
}

export function createSqliteMiSourceProvenanceServiceWithMembership(
  db: WaiaDb,
  deps: MiSourceProvenanceServiceDeps = {},
): MiSourceProvenanceService {
  return createSqliteMiSourceProvenanceService(db, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipSqlite(db, context),
  });
}

export function createPostgresMiSourceProvenanceServiceWithMembership(
  ex: PgMiServiceExecutor,
  deps: MiSourceProvenanceServiceDeps = {},
): MiSourceProvenanceService {
  return createPostgresMiSourceProvenanceService(ex, {
    ...deps,
    assertMembership: deps.assertMembership
      ? deps.assertMembership
      : (context) => assertOrgMembershipPostgres(ex, context),
  });
}
