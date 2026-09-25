import { sql } from "drizzle-orm";
import type { AdminReadTx } from "./snapshot.postgres";
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v == null ? null : new Date(String(v)).toISOString();
/** The same metadata-only state backs the screen and command precondition. */
export async function readConsolePromotionState(
  tx: AdminReadTx,
  organizationId: string,
  strategy: string,
) {
  const rows =
    await tx.execute(sql`SELECT id::text,strategy_id,strategy_version,state::text,state_version,requested_at,effective_at,cooling_off_ends_at,evidence_content_digest,record_content_digest
    FROM trader_strategy_promotion_records WHERE organization_id=${organizationId}::uuid AND strategy_id=${strategy}
    AND state IN ('PENDING_CONFIRM','COOLING_OFF','EFFECTIVE') ORDER BY requested_at DESC NULLS LAST,id LIMIT 4`);
  const records = [...rows].map((r) => ({
    id: String(r.id),
    strategyId: String(r.strategy_id),
    strategyVersion: String(r.strategy_version),
    state: String(r.state),
    stateVersion: Number(r.state_version),
    revision: `promotion:${r.id}:${r.state_version}`,
    requestedAt: iso(r.requested_at),
    effectiveAt: iso(r.effective_at),
    coolingOffEndsAt: iso(r.cooling_off_ends_at),
    evidenceDigest: String(r.evidence_content_digest),
    recordDigest: String(r.record_content_digest),
  }));
  const pending = records.filter((r) => r.state !== "EFFECTIVE"),
    effective = records.filter((r) => r.state === "EFFECTIVE");
  return pending.length > 1 || effective.length > 1
    ? { state: "unavailable" as const, reasons: ["PROMOTION_STATE_AMBIGUOUS"] }
    : { pending: pending[0] ?? null, effective: effective[0] ?? null };
}
