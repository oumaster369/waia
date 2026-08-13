import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import type { AdminRouteHandlerResult } from "@/lib/waia-core/permissions/admin-http";
import { createTreasuryCatalogService } from "@/lib/waia-core/treasury/admin/catalog-service";
import { createMemoryTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/memory-catalog-repository";
import { createPostgresTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/postgres-catalog-repository";
import { treasuryBackendUnavailable } from "@/lib/waia-core/treasury/admin/errors";
import {
  createMemoryTreasuryBreathFactsRepository,
  createPostgresTreasuryBreathFactsRepository,
  createTreasuryBreathReadModel,
} from "@/lib/waia-core/treasury/breath";
import type { AuditLogInput } from "@/lib/waia-core/types";
import {
  createMemoryTreasuryDomainServices,
  createPostgresTreasuryDomainServices,
  type TreasuryDomainServices,
} from "@/lib/waia-core/treasury";
import type { TreasuryCatalogService } from "@/lib/waia-core/treasury/admin/catalog-service";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
import type { TreasuryBreathReadModelPort } from "@/lib/waia-core/treasury/breath/read-model";
import {
  createMemoryTreasuryWatcherRepository,
  createPostgresTreasuryWatcherRepository,
} from "@/lib/waia-core/treasury/watcher";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";
import { resolveTreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/resolve";
import type { TreasuryEvidenceStorage } from "@/lib/waia-core/treasury/evidence/types";

export type TreasuryAdminServices = {
  domain: TreasuryDomainServices;
  catalog: TreasuryCatalogService;
  catalogRepo: TreasuryCatalogRepository;
  watcher: TreasuryWatcherRepository;
  breath: TreasuryBreathReadModelPort;
  evidenceStorage: TreasuryEvidenceStorage | null;
};

export function openProductionTreasuryAdmin(
  runtime: WaiaRuntimeDb,
): TreasuryAdminServices | AdminRouteHandlerResult {
  if (runtime.kind !== "postgres") {
    return treasuryBackendUnavailable();
  }
  const domain = createPostgresTreasuryDomainServices(runtime.db);
  const catalogRepo = createPostgresTreasuryCatalogRepository(runtime.db);
  const catalog = createTreasuryCatalogService({
    catalog: catalogRepo,
    treasury: domain.repository,
    writeAudit: (input) => writeAuditLogPostgres(runtime.db, input),
  });
  return {
    domain,
    catalog,
    catalogRepo,
    watcher: createPostgresTreasuryWatcherRepository(runtime.db),
    breath: createTreasuryBreathReadModel({
      facts: createPostgresTreasuryBreathFactsRepository(runtime.db),
      writeAudit: (input) => writeAuditLogPostgres(runtime.db, input),
    }),
    evidenceStorage: resolveTreasuryEvidenceStorage(),
  };
}

export function createMemoryTreasuryAdminServices(
  writeAudit: (input: AuditLogInput) => string | Promise<string> = async () => "audit-id",
  options?: { evidenceStorage?: TreasuryEvidenceStorage | null; now?: () => Date },
): TreasuryAdminServices {
  const domain = createMemoryTreasuryDomainServices(writeAudit);
  const catalogRepo = createMemoryTreasuryCatalogRepository();
  const watcher = createMemoryTreasuryWatcherRepository(domain.repository);
  const facts = createMemoryTreasuryBreathFactsRepository({
    treasury: domain.repository,
    catalog: catalogRepo,
    watcher,
  });
  const writeAuditAndIndex: typeof writeAudit = async (input) => {
    if (input.organizationId && input.entityId) {
      facts.recordAuditEvent({
        organizationId: input.organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        createdAt: new Date(),
      });
    }
    return writeAudit(input);
  };
  const catalog = createTreasuryCatalogService({
    catalog: catalogRepo,
    treasury: domain.repository,
    writeAudit: writeAuditAndIndex,
  });
  return {
    domain,
    catalog,
    catalogRepo,
    watcher,
    breath: createTreasuryBreathReadModel({
      facts,
      writeAudit: writeAuditAndIndex,
      now: options?.now,
    }),
    evidenceStorage: options?.evidenceStorage ?? null,
  };
}
