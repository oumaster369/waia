import { sql } from "drizzle-orm";
import type { AdminReadTx } from "./snapshot.postgres";
import { canonicalSqlOnSnapshot } from "./canonical-sql-adapter";
import { loadHistoricalObservableProjectionPostgresV2 } from "@/lib/trader/historical-simulation-v2/observable-read-model-postgres-v2";
import type { AdminConsoleQuery } from "../scope";
import type { ResearchRunDetail } from "../research/run-detail";
const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null;
const str = (v: unknown) => (typeof v === "string" && v.length ? v : null);
const decimal = (v: unknown) => (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? v : null);
const rowsOf = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : []);
export const RESEARCH_DETAIL_TABLES = [
  "trader_backtest_runs",
  "trader_backtest_results",
  "research_dataset",
  "trader_historical_simulation_run_start_v2",
  "trader_historical_simulation_run_lifecycle_event_v2",
  "trader_historical_simulation_modeled_evidence_v2",
  "trader_historical_simulation_reason_ledger_v2",
  "trader_historical_simulation_resume_checkpoint_v2",
  "trader_historical_simulation_atomic_stage_v2",
  "trader_historical_simulation_durable_snapshot_v2",
  "trader_historical_forecast_input_pit_v2",
  "trader_forecast_bundle_v2",
  "trader_historical_simulation_resume_snapshot_link_v2",
  "trader_historical_technical_proposal_v2",
  "trader_historical_dataset_authority_v2",
] as const;
export async function readResearchDetail(
  tx: AdminReadTx,
  query: AdminConsoleQuery,
  id: string,
): Promise<ResearchRunDetail | null> {
  const match =
    /^(historical|backtest):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.{1,300})$/i.exec(
      id,
    );
  if (!match || query.exchange_account_id || !["history", "all"].includes(query.mode)) return null;
  const [, kind, org, run] = match;
  if (query.organization_id && query.organization_id !== org) return null;
  const base: ResearchRunDetail = {
    id,
    runId: run,
    organizationId: org,
    kind: kind as "historical" | "backtest",
    phase: "",
    symbol: "",
    partition: "",
    observedAt: null,
    conditions: { dataset: null, period: null, costs: null, version: null, model: null },
    metrics: {
      equity: null,
      cash: null,
      netPnl: null,
      realizedPnl: null,
      fees: null,
      currency: "USDT",
      method: "unavailable",
      forecastQuality: null,
    },
    progress: { committed: null, qualified: null },
    cycles: [],
    artifacts: [],
    resultSlices: [],
    events: [],
    totalCycles: 0,
    truncated: false,
    reasons: [
      "RETURN_METHOD_NOT_RATIFIED",
      "FORECAST_QUALITY_NOT_PERSISTED",
      "SHADOW_JOURNAL_FILE_ONLY",
      "RESEARCH_REASONING_FILE_ONLY",
    ],
  };
  if (kind === "backtest") {
    // Tenant and non-blind filter BEFORE even selecting any metrics payload.
    const row = rowsOf(
      await tx.execute(sql`SELECT r.id::text, r.status::text, r.split::text, r.strategy_id, r.strategy_version,
      r.cost_model_version, r.evidence_digest, COALESCE(r.completed_at,r.started_at,r.created_at) AS observed_at,
      d.name AS dataset_name, d.symbol, CASE WHEN r.split='train' THEN d.train_digest ELSE d.validation_digest END AS dataset_digest
      FROM trader_backtest_runs r JOIN research_dataset d ON d.id=r.dataset_id AND d.organization_id=r.organization_id
      WHERE r.organization_id=${org}::uuid AND r.id::text=${run} AND r.split IN ('train','validation')`),
    )[0];
    if (!row) return null;
    base.phase = String(row.status).toUpperCase();
    base.symbol = String(row.symbol);
    base.partition = String(row.split);
    base.observedAt = iso(row.observed_at);
    base.conditions = {
      dataset: `${row.dataset_name} · ${row.dataset_digest}`,
      period: null,
      costs: String(row.cost_model_version),
      version: `${row.strategy_id} · ${row.strategy_version}`,
      model: null,
    };
    if (str(row.evidence_digest))
      base.artifacts.push({ label: "Доказательство теста", digest: String(row.evidence_digest) });
    // Only the explicit aggregate slice is a run total. Never sum regime slices.
    const results = rowsOf(
      await tx.execute(sql`SELECT b.regime_label,b.metrics_json FROM trader_backtest_results b
      JOIN trader_backtest_runs r ON r.id=b.run_id AND r.organization_id=b.organization_id
      WHERE b.organization_id=${org}::uuid AND r.id::text=${run} AND r.split IN ('train','validation') ORDER BY b.created_at DESC,b.id LIMIT 101`),
    );
    for (const result of results.slice(0, 100)) {
      let slices: unknown = [];
      try {
        slices = JSON.parse(String(result.metrics_json));
      } catch {
        base.reasons.push("BACKTEST_METRICS_INVALID");
      }
      if (!Array.isArray(slices)) {
        base.reasons.push("BACKTEST_METRICS_INVALID");
        continue;
      }
      for (const slice of slices.slice(0, 100)) {
        if (!slice || typeof slice !== "object" || Array.isArray(slice)) continue;
        base.resultSlices.push({
          regime: String(result.regime_label),
          strategySignalId: str(slice.strategySignalId) ?? "",
          realizedPnl: decimal(slice.periodRealizedPnl),
          fees: decimal(slice.periodTotalFees),
          closedTrades:
            Number.isSafeInteger(slice.closedTradeCount) && slice.closedTradeCount >= 0
              ? slice.closedTradeCount
              : null,
          digest: str(slice.evidenceContentDigest),
        });
      }
      if (slices.length > 100) base.reasons.push("BACKTEST_RESULTS_TRUNCATED");
    }
    if (results.length > 100) base.reasons.push("BACKTEST_RESULTS_TRUNCATED");
    // Stored slices can overlap; they are never added into an invented run total.
    base.reasons.push(
      "BACKTEST_NET_PNL_NOT_PERSISTED",
      "BACKTEST_CYCLE_BINDING_NOT_PERSISTED",
      "REPLAY_PERIOD_NOT_PERSISTED",
    );
    if (!results.length) base.reasons.push("BACKTEST_RESULTS_NOT_PERSISTED");
    return base;
  }
  const row = rowsOf(
    await tx.execute(sql`SELECT l.phase,l.symbol,l.partition,l.observed_at,l.committed_cycles,l.qualified_total_cycles,
      s.dataset_authority_digest_hex,s.policy_config_digest_hex
    FROM trader_historical_simulation_run_lifecycle_event_v2 l
    LEFT JOIN trader_historical_simulation_run_start_v2 s ON s.organization_id=l.organization_id AND s.run_id=l.run_id
    WHERE l.organization_id=${org}::uuid AND l.run_id=${run}
    ORDER BY l.event_sequence DESC LIMIT 1`),
  )[0];
  // Holdout payload is never loaded, even through the canonical reader.
  if (!row || !["DEVELOPMENT", "WALK_FORWARD"].includes(String(row.partition))) return null;
  base.phase = String(row.phase);
  base.symbol = String(row.symbol);
  base.partition = String(row.partition);
  base.observedAt = iso(row.observed_at);
  base.progress = {
    committed: Number(row.committed_cycles),
    qualified: Number(row.qualified_total_cycles),
  };
  base.conditions.dataset = str(row.dataset_authority_digest_hex);
  if (str(row.policy_config_digest_hex))
    base.artifacts.push({
      label: "Конфигурация политики",
      digest: String(row.policy_config_digest_hex),
    });
  if (base.conditions.dataset)
    base.artifacts.push({ label: "Набор данных", digest: base.conditions.dataset });
  base.events = rowsOf(
    await tx.execute(sql`SELECT phase,observed_at,error_code,committed_cycles FROM trader_historical_simulation_run_lifecycle_event_v2
    WHERE organization_id=${org}::uuid AND run_id=${run} ORDER BY event_sequence DESC LIMIT 50`),
  ).map((e) => ({
    phase: String(e.phase),
    at: iso(e.observed_at)!,
    errorCode: str(e.error_code),
    committed: Number(e.committed_cycles),
  }));
  try {
    const projection = await loadHistoricalObservableProjectionPostgresV2(
      canonicalSqlOnSnapshot(tx),
      { organizationId: org, runId: run },
    );
    base.metrics = {
      ...base.metrics,
      equity: projection.aggregate.equity,
      cash: projection.aggregate.cash,
      netPnl: projection.aggregate.netPnl,
      method: "historical_durable_checkpoint/v2",
    };
    const cycles = projection.accounts
      .flatMap((a) => a.history)
      .sort((a, b) => a.cycleSequence - b.cycleSequence);
    base.totalCycles = cycles.length;
    base.truncated = cycles.length > 200;
    base.cycles = cycles
      .slice(-200)
      .map((c) => ({
        id: c.cycleId,
        accountId: c.accountId,
        sequence: c.cycleSequence,
        at: c.replayBarClosedAtUtc,
        netPnl: c.netPnl,
        fills: c.fillsCount,
        decisions: c.decisionsCount,
        riskVetoes: c.riskVetoCount,
        checkpoint: c.checkpoint?.contentDigestHex ?? null,
      }));
    if (cycles.length)
      base.conditions.period = `${cycles[0].replayBarClosedAtUtc} — ${cycles.at(-1)!.replayBarClosedAtUtc}`;
    if (!cycles.length) base.reasons.push("HISTORICAL_COMMITTED_CYCLES_NOT_PERSISTED");
    if (base.truncated) base.reasons.push("RESEARCH_CYCLES_TRUNCATED");
  } catch (error) {
    if (!(error instanceof Error) || !/^HISTORICAL_/.test(error.message)) throw error;
    base.reasons.push("HISTORICAL_EVIDENCE_INCOMPLETE");
  }
  base.reasons.push(
    "RESEARCH_COST_CONDITIONS_NOT_PERSISTED",
    "RESEARCH_STRATEGY_VERSION_NOT_PERSISTED",
  );
  return base;
}
