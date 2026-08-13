import type { WaiaRuntimeDb } from "@/db/waia-runtime-db";
import { writeAuditLogPostgres } from "@/lib/waia-core/audit/write";
import type { AdminRouteHandlerResult } from "@/lib/waia-core/permissions/admin-http";
import { createTreasuryCatalogService } from "@/lib/waia-core/treasury/admin/catalog-service";
import { createMemoryTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/memory-catalog-repository";
import { createPostgresTreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/postgres-catalog-repository";
import { createUnreadyTreasuryBreathReadModel } from "@/lib/waia-core/treasury/admin/breath-port";
import { treasuryBackendUnavailable } from "@/lib/waia-core/treasury/admin/errors";
import type { AuditLogInput } from "@/lib/waia-core/types";
import {
  createMemoryTreasuryDomainServices,
  createPostgresTreasuryDomainServices,
  type TreasuryDomainServices,
} from "@/lib/waia-core/treasury";
import type { TreasuryCatalogService } from "@/lib/waia-core/treasury/admin/catalog-service";
import type { TreasuryCatalogRepository } from "@/lib/waia-core/treasury/admin/catalog-repository.types";
import type { TreasuryBreathReadModelPort } from "@/lib/waia-core/treasury/admin/breath-port";
import {
  createMemoryTreasuryWatcherRepository,
  createPostgresTreasuryWatcherRepository,
} from "@/lib/waia-core/treasury/watcher";
import type { TreasuryWatcherRepository } from "@/lib/waia-core/treasury/watcher/repository.types";

export type TreasuryAdminServices = {
  domain: TreasuryDomainServices;
  catalog: TreasuryCatalogService;
  catalogRepo: TreasuryCatalogRepository;
  watcher: TreasuryWatcherRepository;
  breath: TreasuryBreathReadModelPort;
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
    breath: createUnreadyTreasuryBreathReadModel(),
  };
}

export function createMemoryTreasuryAdminServices(
  writeAudit: (input: AuditLogInput) => string | Promise<string> = async () => "audit-id",
): TreasuryAdminServices {
  const domain = createMemoryTreasuryDomainServices(writeAudit);
  const catalogRepo = createMemoryTreasuryCatalogRepository();
  const catalog = createTreasuryCatalogService({
    catalog: catalogRepo,
    treasury: domain.repository,
    writeAudit,
  });
  return {
    domain,
    catalog,
    catalogRepo,
    watcher: createMemoryTreasuryWatcherRepository(domain.repository),
    breath: createUnreadyTreasuryBreathReadModel(),
  };
}
