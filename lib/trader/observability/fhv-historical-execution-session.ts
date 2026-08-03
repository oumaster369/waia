import { getDb } from "@/db/client";
import { enableIdhpsProductionBans } from "@/lib/trader/execution/idhps-hot-path-counters";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import type { InMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { seedFhvSqliteResearchOrganization } from "@/lib/trader/observability/fhv-sqlite-research-org-seed";

export type FhvHistoricalExecutionSession = Readonly<{
  session: InMemoryResearchBacktestSession;
  context: OrgContext;
  cleanup: () => void;
}>;

const FHV_NOOP_TELEMETRY_SINK = (): void => {};

export async function seedFhvHistoricalExecutionSession(input: {
  organizationId: string;
  operatorId: string;
  slot?: number;
  sessionDbPath?: string;
}): Promise<FhvHistoricalExecutionSession> {
  const session = await createInMemoryResearchBacktestSession({
    ...(input.sessionDbPath ? { sessionDbPath: input.sessionDbPath } : {}),
    // Official FHV path must not flood stdout with per-transition trader telemetry.
    telemetrySink: FHV_NOOP_TELEMETRY_SINK,
  });
  enableIdhpsProductionBans();
  const db = getDb();
  seedFhvSqliteResearchOrganization({
    db,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    slot: input.slot,
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(
    requireOrgContext(input.organizationId),
    {
      ...DEFAULT_ORG_RISK_LIMITS,
      maxConcurrentPositions: 10,
    },
  );
  const cleanup = () => {
    session.cleanup();
  };
  return {
    session,
    context: requireOrgContext(input.organizationId),
    cleanup,
  };
}
