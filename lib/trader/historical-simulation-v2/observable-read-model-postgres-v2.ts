import type postgres from "postgres";
import {
  HISTORICAL_OBSERVABLE_READ_MODEL_V2,
  type HistoricalObservableAccountV2,
  type HistoricalObservableProjectionV2,
  type HistoricalObservableScopeV2,
} from "./observable-read-model-v2";
import { validateHistoricalSimulationDurableStateSnapshotV2 } from "./atomic-cycle-commit-v2";

type Sql = Pick<postgres.Sql, "unsafe">;
type Row = Record<string, unknown>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const parsedJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value) as unknown; } catch { return undefined; }
};
const object = (value: unknown): Record<string, unknown> => {
  const parsed = parsedJson(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
};
const array = (value: unknown): readonly unknown[] => {
  const parsed = parsedJson(value); return Array.isArray(parsed) ? parsed : [];
};
const number = (value: unknown): number => Number.isFinite(Number(value)) ? Number(value) : 0;
const decimalSum = (values: readonly (string | null)[]): string | null => {
  const known = values.filter((value): value is string => value !== null);
  if (known.length === 0) return null;
  const scaled = known.reduce((sum, value) => {
    const match = /^(-?)(\d+)(?:\.(\d{1,8}))?$/.exec(value);
    if (!match) throw new Error("HISTORICAL_OBSERVABLE_DECIMAL_INVALID");
    const units = BigInt(match[2]!) * 100_000_000n + BigInt((match[3] ?? "").padEnd(8, "0"));
    return sum + (match[1] === "-" ? -units : units);
  }, 0n);
  const sign = scaled < 0n ? "-" : ""; const absolute = scaled < 0n ? -scaled : scaled;
  return `${sign}${absolute / 100_000_000n}.${String(absolute % 100_000_000n).padStart(8, "0")}`;
};

function projectAccount(row: Row): HistoricalObservableAccountV2 {
  if (!row.accounting_state_json) throw new Error(`HISTORICAL_OBSERVABLE_ACCOUNTING_SNAPSHOT_MISSING:${Object.keys(row).join(",")}`);
  const accounting = object(row.accounting_state_json);
  const portfolio = object(accounting.positions);
  const risk = object(row.risk_json);
  const execution = object(row.execution_json);
  const effects = array(row.observed_execution_effects_json);
  const bases = Object.values(portfolio).map((position) => text(object(position).netPositionBasis));
  const netBasis = decimalSum(bases) ?? "0.00000000";
  const marked = text(accounting.markedPositionValue);
  const netUnrealizedPnl = marked !== null
    ? decimalSum([marked, netBasis.startsWith("-") ? netBasis.slice(1) : `-${netBasis}`]) : null;
  const netRealizedPnl = text(accounting.netRealizedPnl);
  validateHistoricalSimulationDurableStateSnapshotV2({
    schemaVersion: String(row.accounting_snapshot_schema_version) as "waia.trader.historical_simulation_durable_state_snapshot.v2",
    organizationId: String(row.organization_id), accountId: String(row.account_id), runId: String(row.run_id),
    cycleId: String(row.accounting_snapshot_cycle_id), stateKind: "ACCOUNTING_FRONTIER",
    state: accounting as never, contentDigestHex: String(row.accounting_snapshot_content_digest_hex),
  }, "ACCOUNTING_FRONTIER", { organizationId: String(row.organization_id), accountId: String(row.account_id),
    runId: String(row.run_id), cycleId: String(row.accounting_snapshot_cycle_id), split: row.partition as "DEVELOPMENT" | "WALK_FORWARD" });
  const checkpoint = row.checkpoint_content_digest_hex ? {
    committedCycleSequence: number(row.committed_cycle_sequence),
    nextRecordIndex: number(row.next_record_index),
    nextCycleSequence: number(row.next_cycle_sequence),
    contentDigestHex: String(row.checkpoint_content_digest_hex),
  } : null;
  return {
    accountId: String(row.account_id), cycleSequence: number(row.cycle_sequence),
    cycleId: String(row.cycle_id), symbol: String(row.symbol),
    partition: row.partition as "DEVELOPMENT" | "WALK_FORWARD",
    replayBarClosedAtUtc: new Date(String(row.replay_bar_closed_at_utc)).toISOString(),
    cash: text(accounting.cash), equity: text(accounting.equity),
    netPnl: netRealizedPnl !== null && netUnrealizedPnl !== null ? decimalSum([netRealizedPnl, netUnrealizedPnl]) : null,
    grossRealizedPnl: text(accounting.grossRealizedPnl), netRealizedPnl, netUnrealizedPnl,
    openPositionsCount: Object.values(portfolio).filter((position) => {
      const quantity = text(object(position).quantity); return quantity !== null && !/^[-+]?0+(?:\.0+)?$/.test(quantity);
    }).length,
    decisionsCount: number(row.decisions_count), riskVetoCount: number(row.risk_veto_count),
    ordersCount: number(row.orders_count), fillsCount: number(row.fills_count),
    lastDecision: row.decision_json, lastRisk: risk, lastExecution: execution,
    lastAccounting: accounting, lastGuardian: row.guardian_json, lastLearning: row.learning_json,
    observedExecutionEffects: effects,
    stages: array(row.stages).map(String), snapshots: array(row.snapshots).map(String), checkpoint,
    ledgerHeadContentDigestHex: String(row.content_digest_hex),
  };
}

/** One REPEATABLE READ projection; every query is bound to org+run and optionally account. */
export async function loadHistoricalObservableProjectionPostgresV2(
  sql: Sql,
  scope: HistoricalObservableScopeV2,
): Promise<HistoricalObservableProjectionV2> {
  if (!scope.organizationId || !scope.runId || scope.accountId === "") {
    throw new Error("HISTORICAL_OBSERVABLE_SCOPE_INVALID");
  }
  const accountClause = scope.accountId ? "AND l.account_id = $3" : "";
  const params = scope.accountId
    ? [scope.organizationId, scope.runId, scope.accountId]
    : [scope.organizationId, scope.runId];
  const rows = await sql.unsafe<Row[]>(`
    WITH scoped AS (
      SELECT l.*, c.committed_cycle_sequence,c.next_record_index,c.next_cycle_sequence,c.checkpoint_content_digest_hex,
        row_number() OVER (PARTITION BY l.account_id ORDER BY c.committed_cycle_sequence DESC) AS latest_rank,
        count(*) OVER (PARTITION BY l.account_id) AS decisions_count,
        count(*) FILTER (WHERE coalesce(l.risk_json->>'status',l.risk_json->>'verdict','') IN ('VETO','REJECTED','DENIED'))
          OVER (PARTITION BY l.account_id) AS risk_veto_count,
        count(*) FILTER (WHERE l.execution_json->>'planContentDigestHex' IS NOT NULL)
          OVER (PARTITION BY l.account_id) AS orders_count,
        (SELECT count(*) FROM trader_historical_simulation_modeled_evidence_v2 e
          JOIN trader_historical_simulation_reason_ledger_v2 el ON el.entry_id=e.reason_ledger_entry_id
          JOIN trader_historical_simulation_resume_checkpoint_v2 ec
            ON ec.organization_id=el.organization_id AND ec.account_id=el.account_id AND ec.run_id=el.run_id
            AND ec.committed_cycle_sequence=el.cycle_sequence AND ec.committed_cycle_id=el.cycle_id
            AND ec.ledger_entry_id=el.entry_id AND ec.ledger_head_content_digest_hex=el.content_digest_hex
          WHERE el.organization_id=l.organization_id AND el.account_id=l.account_id AND el.run_id=l.run_id
            AND e.evidence_kind='FILL') AS fills_count
      FROM trader_historical_simulation_reason_ledger_v2 l
      JOIN trader_historical_simulation_resume_checkpoint_v2 c
        ON c.organization_id=l.organization_id AND c.account_id=l.account_id AND c.run_id=l.run_id
        AND c.committed_cycle_sequence=l.cycle_sequence AND c.committed_cycle_id=l.cycle_id
        AND c.ledger_entry_id=l.entry_id AND c.ledger_head_content_digest_hex=l.content_digest_hex
      WHERE l.organization_id=$1::uuid AND l.run_id=$2 ${accountClause}
        AND l.partition IN ('DEVELOPMENT','WALK_FORWARD') AND l.capital_eligible=false
    )
    SELECT s.*,
      coalesce((SELECT jsonb_agg(stage ORDER BY stage) FROM trader_historical_simulation_atomic_stage_v2 st
        WHERE st.organization_id=s.organization_id AND st.account_id=s.account_id AND st.run_id=s.run_id
          AND st.cycle_sequence=s.cycle_sequence),'[]'::jsonb) AS stages,
      coalesce((SELECT jsonb_agg(state_kind ORDER BY state_kind) FROM trader_historical_simulation_durable_snapshot_v2 sn
        WHERE sn.organization_id=s.organization_id AND sn.account_id=s.account_id AND sn.run_id=s.run_id
          AND sn.cycle_sequence=s.cycle_sequence),'[]'::jsonb) AS snapshots,
      accounting_snapshot.state_json AS accounting_state_json,
      accounting_snapshot.snapshot_content_digest_hex AS accounting_snapshot_content_digest_hex,
      accounting_snapshot.schema_version AS accounting_snapshot_schema_version,
      accounting_snapshot.cycle_id AS accounting_snapshot_cycle_id
    FROM scoped s
    LEFT JOIN LATERAL (SELECT sn.state_json,sn.snapshot_content_digest_hex,sn.schema_version,sn.cycle_id
      FROM trader_historical_simulation_resume_snapshot_link_v2 sl
      JOIN trader_historical_simulation_durable_snapshot_v2 sn
        ON sn.organization_id=sl.organization_id AND sn.account_id=sl.account_id AND sn.run_id=sl.run_id
        AND sn.cycle_sequence=sl.committed_cycle_sequence AND sn.state_kind=sl.state_kind
        AND sn.snapshot_content_digest_hex=sl.snapshot_content_digest_hex
      WHERE sl.organization_id=s.organization_id AND sl.account_id=s.account_id AND sl.run_id=s.run_id
        AND sl.committed_cycle_sequence=s.committed_cycle_sequence AND sl.state_kind='ACCOUNTING_FRONTIER'
      LIMIT 1) accounting_snapshot ON true
    WHERE s.latest_rank=1 ORDER BY s.account_id`, params);
  const accounts = rows.map(projectAccount);
  const last = accounts.reduce((max, account) => Math.max(max, account.cycleSequence), -1);
  const heads = accounts.map((account) => account.ledgerHeadContentDigestHex).sort().join(":");
  return {
    schemaVersion: HISTORICAL_OBSERVABLE_READ_MODEL_V2, mode: "HISTORICAL_SIMULATION",
    capitalEligible: false, organizationId: scope.organizationId, runId: scope.runId,
    eventId: `${last}:${heads}`, observedAt: new Date().toISOString(), accounts,
    aggregate: {
      accountCount: accounts.length, equity: decimalSum(accounts.map((a) => a.equity)),
      cash: decimalSum(accounts.map((a) => a.cash)), netPnl: decimalSum(accounts.map((a) => a.netPnl)),
      cycles: accounts.reduce((sum, a) => sum + a.cycleSequence + 1, 0),
      decisions: accounts.reduce((sum, a) => sum + a.decisionsCount, 0),
      riskVetoes: accounts.reduce((sum, a) => sum + a.riskVetoCount, 0),
      orders: accounts.reduce((sum, a) => sum + a.ordersCount, 0),
      fills: accounts.reduce((sum, a) => sum + a.fillsCount, 0),
      processedRecords: accounts.reduce((sum, a) => sum + (a.checkpoint?.nextRecordIndex ?? 0), 0),
      latestCycleSequence: accounts.length === 0 ? null : Math.max(...accounts.map((a) => a.cycleSequence)),
    },
  };
}
