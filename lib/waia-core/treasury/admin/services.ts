import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import type { AdminRouteHandlerResult } from "@/lib/waia-core/permissions/admin-http";
import { createTreasuryCatalogService } from "@/lib/waia-core/treasury/admin/catalog-service";
import { createMemoryTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/memory-catalog-repository";
import { createPostgresTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/postgres-catalog-repository";
import {
  createTreasuryLedgerCatalogService,
  type TreasuryLedgerCatalogService,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-service";
import type { TreasuryLedgerCatalogRepository } from "@/lib/waia-core/treasury/admin/ledger-catalog-repository.types";
import { createMemoryTreasuryLedgerCatalogRepository } from "@/lib/waia-core/treasury/admin/memory-ledger-catalog-repository";
import { createPostgresTreasuryLedgerCatalogRepository } from "@/lib/waia-core/treasury/admin/postgres-ledger-catalog-repository";
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
  ledgerCatalog: TreasuryLedgerCatalogService;
  ledgerCatalogRepo: TreasuryLedgerCatalogRepository;
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
  const ledgerCatalogRepo = createPostgresTreasuryLedgerCatalogRepository(runtime.db);
  const ledgerCatalog = createTreasuryLedgerCatalogService({
    repository: ledgerCatalogRepo,
    writeAudit: (input) => writeAuditLogPostgres(runtime.db, input),
    watchedAddressExists: async (context, id) =>
      (await catalogRepo.getWatchedAddress(context, id)) !== null,
  });
  return {
    domain,
    catalog,
    catalogRepo,
    ledgerCatalog,
    ledgerCatalogRepo,
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
  const ledgerCatalogRepo = createMemoryTreasuryLedgerCatalogRepository();
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
  const ledgerCatalog = createTreasuryLedgerCatalogService({
    repository: ledgerCatalogRepo,
    writeAudit: writeAuditAndIndex,
    watchedAddressExists: async (context, id) =>
      (await catalogRepo.getWatchedAddress(context, id)) !== null,
    now: options?.now,
  });
  return {
    domain,
    catalog,
    catalogRepo,
    ledgerCatalog,
    ledgerCatalogRepo,
    watcher,
    breath: createTreasuryBreathReadModel({
      facts,
      writeAudit: writeAuditAndIndex,
      now: options?.now,
    }),
    evidenceStorage: options?.evidenceStorage ?? null,
  };
}
