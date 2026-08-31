import type postgres from "postgres";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  type HistoricalSimulationReasonLedgerV2,
  validateHistoricalSimulationReasonLedgerV2,
} from "@/lib/trader/historical-simulation-v2/reason-ledger-v2";

export type HistoricalSimulationModeledEvidenceKindV2 = "RISK" | "EXECUTION" | "GUARDIAN" | "FILL";
export type HistoricalSimulationModeledEvidenceV2 = Readonly<{
  evidenceId: string;
  organizationId: string;
  reasonLedgerEntryId: string;
  evidenceKind: HistoricalSimulationModeledEvidenceKindV2;
  evidenceOrdinal: number;
  sourceContentDigestHex: string | null;
  evidenceContentDigestHex: string;
  payload: Readonly<Record<string, unknown>>;
  capitalEligible: false;
}>;

function evidence(input: Omit<HistoricalSimulationModeledEvidenceV2, "evidenceId" | "evidenceContentDigestHex" | "capitalEligible">): HistoricalSimulationModeledEvidenceV2 {
  const body = { ...input, capitalEligible: false as const };
  const evidenceContentDigestHex = computeSemanticSha256Hex(body);
  return { ...body, evidenceContentDigestHex, evidenceId: evidenceContentDigestHex };
}

/** Derives simulation-only evidence. These records are explicitly not exchange fills or canonical Reality V2. */
export function deriveHistoricalSimulationModeledEvidenceV2(entry: HistoricalSimulationReasonLedgerV2): readonly HistoricalSimulationModeledEvidenceV2[] {
  const common = { organizationId: entry.organizationId, reasonLedgerEntryId: entry.entryId };
  return [
    evidence({ ...common, evidenceKind: "RISK", evidenceOrdinal: 0, sourceContentDigestHex: entry.risk.verdictContentDigestHex, payload: entry.risk }),
    evidence({ ...common, evidenceKind: "EXECUTION", evidenceOrdinal: 0, sourceContentDigestHex: entry.execution.reportContentDigestHex, payload: entry.execution }),
    evidence({ ...common, evidenceKind: "GUARDIAN", evidenceOrdinal: 0, sourceContentDigestHex: entry.guardian.assessmentContentDigestHex, payload: entry.guardian }),
    ...entry.execution.fillContentDigestHexes.map((digest, evidenceOrdinal) => evidence({
      ...common,
      evidenceKind: "FILL",
      evidenceOrdinal,
      sourceContentDigestHex: digest,
      payload: { modeledFillContentDigestHex: digest, sourceClass: "HISTORICAL_SIMULATION_V2_MODELED_FILL" },
    })),
  ];
}

export async function appendHistoricalSimulationReasonLedgerV2Postgres(input: {
  sql: postgres.Sql;
  entry: HistoricalSimulationReasonLedgerV2;
}): Promise<{ inserted: boolean; evidenceCount: number }> {
  if (!validateHistoricalSimulationReasonLedgerV2(input.entry)) throw new Error("invalid Historical Simulation V2 reason-ledger entry");
  const entry = input.entry;
  const modeled = deriveHistoricalSimulationModeledEvidenceV2(entry);
  return input.sql.begin(async (tx) => {
    const sql = tx as unknown as postgres.Sql;
    const existing = await sql<{ content_digest_hex: string }[]>`
      SELECT content_digest_hex FROM trader_historical_simulation_reason_ledger_v2
      WHERE organization_id=${entry.organizationId} AND run_id=${entry.runId} AND cycle_sequence=${entry.cycleSequence}
      FOR UPDATE
    `;
    if (existing[0]) {
      if (existing[0].content_digest_hex !== entry.contentDigestHex) throw new Error("reason-ledger sequence conflict");
      return { inserted: false, evidenceCount: modeled.length };
    }
    const prior = entry.cycleSequence === 0 ? [] : await sql<{ content_digest_hex: string }[]>`
      SELECT content_digest_hex FROM trader_historical_simulation_reason_ledger_v2
      WHERE organization_id=${entry.organizationId} AND run_id=${entry.runId} AND cycle_sequence=${entry.cycleSequence - 1}
      FOR UPDATE
    `;
    if (entry.cycleSequence === 0 ? entry.previousContentDigestHex !== null : prior[0]?.content_digest_hex !== entry.previousContentDigestHex) {
      throw new Error("reason-ledger predecessor/digest mismatch");
    }
    await sql`
      INSERT INTO trader_historical_simulation_reason_ledger_v2 (
        entry_id, organization_id, run_id, cycle_id, cycle_sequence, symbol, partition, capital_eligible,
        replay_bar_closed_at_utc, previous_content_digest_hex, forecast_json, decision_json, portfolio_json,
        risk_json, execution_json, accounting_json, guardian_json, learning_json, content_digest_hex
      ) VALUES (
        ${entry.entryId}, ${entry.organizationId}, ${entry.runId}, ${entry.cycleId}, ${entry.cycleSequence}, ${entry.symbol},
        ${entry.partition}, false, ${entry.replayBarClosedAtUtc}, ${entry.previousContentDigestHex},
        ${sql.json(entry.forecast)}, ${sql.json(entry.decision)}, ${sql.json(entry.portfolio)}, ${sql.json(entry.risk)},
        ${sql.json(entry.execution)}, ${sql.json(entry.accounting)}, ${sql.json(entry.guardian)}, ${sql.json(entry.learning)},
        ${entry.contentDigestHex}
      )
    `;
    for (const item of modeled) {
      await sql`
        INSERT INTO trader_historical_simulation_modeled_evidence_v2 (
          evidence_id, organization_id, reason_ledger_entry_id, evidence_kind, evidence_ordinal,
          source_content_digest_hex, evidence_content_digest_hex, payload_json, capital_eligible
        ) VALUES (
          ${item.evidenceId}, ${item.organizationId}, ${item.reasonLedgerEntryId}, ${item.evidenceKind}, ${item.evidenceOrdinal},
          ${item.sourceContentDigestHex}, ${item.evidenceContentDigestHex}, ${sql.json(item.payload as postgres.JSONValue)}, false
        )
      `;
    }
    return { inserted: true, evidenceCount: modeled.length };
  });
}

export async function readHistoricalSimulationReasonLedgerV2Postgres(input: {
  sql: postgres.Sql;
  organizationId: string;
  runId: string;
}): Promise<readonly HistoricalSimulationReasonLedgerV2[]> {
  type LedgerRow = Record<string, unknown> & {
    entry_id: string; organization_id: string; run_id: string; cycle_id: string; cycle_sequence: number;
    symbol: string; partition: "DEVELOPMENT" | "WALK_FORWARD"; replay_bar_closed_at_utc: string | Date;
    previous_content_digest_hex: string | null; forecast_json: HistoricalSimulationReasonLedgerV2["forecast"];
    decision_json: HistoricalSimulationReasonLedgerV2["decision"]; portfolio_json: HistoricalSimulationReasonLedgerV2["portfolio"];
    risk_json: HistoricalSimulationReasonLedgerV2["risk"]; execution_json: HistoricalSimulationReasonLedgerV2["execution"];
    accounting_json: HistoricalSimulationReasonLedgerV2["accounting"]; guardian_json: HistoricalSimulationReasonLedgerV2["guardian"];
    learning_json: HistoricalSimulationReasonLedgerV2["learning"]; content_digest_hex: string;
  };
  const rows = await input.sql<LedgerRow[]>`
    SELECT * FROM trader_historical_simulation_reason_ledger_v2
    WHERE organization_id=${input.organizationId} AND run_id=${input.runId}
    ORDER BY cycle_sequence
  `;
  return rows.map((row) => {
    const value = {
      schemaVersion: "waia.trader.historical_simulation_reason_ledger.v2",
      entryId: row.entry_id,
      organizationId: row.organization_id,
      runId: row.run_id,
      cycleId: row.cycle_id,
      cycleSequence: row.cycle_sequence,
      symbol: row.symbol,
      partition: row.partition,
      capitalEligible: false,
      replayBarClosedAtUtc: new Date(row.replay_bar_closed_at_utc).toISOString(),
      previousContentDigestHex: row.previous_content_digest_hex,
      forecast: row.forecast_json,
      decision: row.decision_json,
      portfolio: row.portfolio_json,
      risk: row.risk_json,
      execution: row.execution_json,
      accounting: row.accounting_json,
      guardian: row.guardian_json,
      learning: row.learning_json,
      contentDigestHex: row.content_digest_hex,
    } as HistoricalSimulationReasonLedgerV2;
    if (!validateHistoricalSimulationReasonLedgerV2(value)) throw new Error(`persisted reason-ledger digest mismatch: ${value.entryId}`);
    return value;
  });
}
