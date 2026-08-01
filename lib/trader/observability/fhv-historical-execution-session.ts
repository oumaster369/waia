import { getDb } from "@/db/client";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import type { InMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

export type FhvHistoricalExecutionSession = Readonly<{
  session: InMemoryResearchBacktestSession;
  context: OrgContext;
  cleanup: () => void;
}>;

export async function seedFhvHistoricalExecutionSession(input: {
  organizationId: string;
  operatorId: string;
  slot?: number;
}): Promise<FhvHistoricalExecutionSession> {
  const slot = input.slot ?? 436;
  const userId = `00000000-0000-4000-8000-${String(slot).padStart(12, "0")}`;
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: userId,
    email: `fhv-historical-${input.operatorId}-${slot}@waia.invalid`,
    password: "password123",
    identityLabel: "FHV Historical Execution",
  });
  const seededOrgId = ensureUserCoreSeedSqlite(db, {
    userId,
    displayName: "FHV Historical Execution",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(seededOrgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
    maxConcurrentPositions: 10,
  });
  const cleanup = () => {
    session.cleanup();
  };
  return {
    session,
    context: requireOrgContext(input.organizationId),
    cleanup,
  };
}
