import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { getDb, resetWaiaSqliteSingleton } from "@/db/client";
import { MockExchangeConnector } from "@/lib/trader/connectors/mock-exchange-connector";
import {
  createOrderExecutionServiceFromDeps,
  createSqliteOrderRepository,
  createSqliteReconciliationService,
} from "@/lib/trader/execution";
import type { OrderRepository } from "@/lib/trader/execution/order-repository.types";
import type { PaperCycleDeps } from "@/lib/trader/paper/paper-cycle.types";
import { createInMemoryOrderRateStore } from "@/lib/trader/risk/order-rate-store";
import {
  createKillSwitchResolver,
  createSqliteKillSwitchRepository,
  createRiskEngineService,
} from "@/lib/trader/risk";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import type { TraderAuditInput } from "@/lib/trader/types";

function migrateInMemoryResearchDb(): void {
  resetWaiaSqliteSingleton();
  const db = getDb();
  migrate(db, { migrationsFolder: path.join(process.cwd(), "db/migrations") });
}

export type InMemoryResearchBacktestSession = {
  deps: PaperCycleDeps;
  orderRepository: OrderRepository;
  cleanup: () => void;
};

/** Isolated SQLite session for validation replay — no Postgres mock order mutation. */
export function createInMemoryResearchBacktestSession(): InMemoryResearchBacktestSession {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "waia-see-a15-"));
  const dbPath = path.join(tempDir, "research-replay.sqlite");
  process.env.DATABASE_URL = dbPath;

  migrateInMemoryResearchDb();

  const db = getDb();
  const writeAudit = (_input: TraderAuditInput) => "see-a15-audit";
  const nowMs = () => Date.now();
  const connector = new MockExchangeConnector();

  const orderRepository = createSqliteOrderRepository(db);
  const killSwitchResolver = createKillSwitchResolver({
    repository: createSqliteKillSwitchRepository(db),
    nowMs,
  });
  const limitsService = createSqliteRiskLimitsService(db);
  const riskEngine = createRiskEngineService({
    limitsService,
    killSwitchResolver,
    rateStore: createInMemoryOrderRateStore(),
    writeAudit,
    nowMs,
    newDecisionId: () => crypto.randomUUID(),
  });
  const execution = createOrderExecutionServiceFromDeps({
    riskEngine,
    orderRepository,
    killSwitchResolver,
    connectorForMode: () => connector,
    writeAudit,
    nowMs,
  });
  const reconciliation = createSqliteReconciliationService(db, {
    connectorForMode: () => connector,
    nowMs,
    writeAudit,
  });

  return {
    deps: { execution, reconciliation },
    orderRepository,
    cleanup: () => {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // best-effort temp cleanup
      }
    },
  };
}
