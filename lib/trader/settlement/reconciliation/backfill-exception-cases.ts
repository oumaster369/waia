import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
if (process.env.VITEST !== "true") {
  require("server-only");
}

import {
  createCase,
  type CreateCaseDeps,
} from "@/lib/trader/settlement/reconciliation/create-case";
import type { ReconciliationReader } from "@/lib/trader/settlement/reconciliation/reconciliation-reader.types";
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";

export type BackfillExceptionCasesDeps = CreateCaseDeps & {
  reader: Pick<ReconciliationReader, "listExceptionSettlementsWithoutCase">;
};

export type BackfillExceptionCasesResult = {
  processed: number;
  created: number;
};

export async function backfillExceptionCases(
  deps: BackfillExceptionCasesDeps,
  context: OrgContext,
): Promise<BackfillExceptionCasesResult> {
  const scoped = requireOrgContext(context.organizationId);
  const orphans = await deps.reader.listExceptionSettlementsWithoutCase(scoped);
  let created = 0;

  for (const settlement of orphans) {
    const before = await deps.caseRepository.findBySettlementId(scoped, settlement.id);
    await createCase(deps, scoped, { settlement });
    const after = await deps.caseRepository.findBySettlementId(scoped, settlement.id);
    if (!before && after) {
      created += 1;
    }
  }

  return { processed: orphans.length, created };
}
