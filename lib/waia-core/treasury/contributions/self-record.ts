import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { resolvePublicTreasuryOrganization } from "@/lib/waia-core/treasury/public/binding";
import { createContributionShareEngine } from "@/lib/waia-core/treasury/share/engine";
import { createPostgresContributionShareFactsRepository } from "@/lib/waia-core/treasury/share/postgres-repository";
import type { SelfContributionRecord } from "@/lib/waia-core/treasury/share/types";

/** Private, session-user-only contribution history from verified Treasury facts. */
export async function readSelfContributionRecordForUser(
  userId: string,
): Promise<SelfContributionRecord | null> {
  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    if (runtime.kind !== "postgres") return null;
    const facts = createPostgresContributionShareFactsRepository(runtime.db);
    const engine = createContributionShareEngine(facts);
    return await engine.computeSelfRecord(resolvePublicTreasuryOrganization(), userId);
  } catch {
    // Private dashboard remains usable while financial history fails closed.
    return null;
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
}
