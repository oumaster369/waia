import type { WaiaDb } from "@/db/types";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import type { SettlementRecordView } from "@/lib/trader/settlement/settlement.types";
import type { ReconciliationEvidenceSnapshot } from "@/lib/trader/settlement/reconciliation/reconciliation.types";
import type { OrgContext } from "@/lib/waia-core/scope/org-context";

export type ReconciliationEvidenceReader = {
  buildEvidence(
    context: OrgContext,
    settlement: SettlementRecordView,
  ): Promise<ReconciliationEvidenceSnapshot>;
};

export type ReconciliationEvidenceReaderFactory = {
  createPostgres: (ex: Pick<WaiaPostgresDb, "select">) => ReconciliationEvidenceReader;
  createSqlite: (ex: Pick<WaiaDb, "select">) => ReconciliationEvidenceReader;
};
