import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TERMINAL_SCORING_AMENDMENT_DIGEST, TERMINAL_SCORING_CONTRACT, TERMINAL_SCORING_METRIC } from "@/lib/trader/research/benchmark/terminal-scoring-protocol-v2";
// 0206 is immutable Brier-era history; current CDF protocol is tested separately.
const PREDICTIVE_TERMINAL_RECEIPT_VERSION = "predictive-terminal-receipt/v2";
const SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION = "scientific-admission-receipt/v3";
const RESEARCH_HARNESS_ADMISSION_VERSION = "research-harness-admission/v4";

describe("DEE-992 RLS protocol-only delta", () => {
  it("preserves every original tenant/request/proposal/Human predicate exactly", () => {
    const original = readFileSync("db/migrations_postgres/0201_historical_ratification_split_v2.sql", "utf8");
    const next = readFileSync("db/migrations_postgres/0206_historical_brier_admission_v3.sql", "utf8");
    const start = original.indexOf("DROP POLICY IF EXISTS historical_scientific_admission_runner_insert_v2");
    const policy = original.slice(start, original.indexOf("--> statement-breakpoint", start)).trim();
    const nextPolicy = next.slice(next.indexOf("DROP POLICY")).trim();
    const newBoundary = `AND schema_version='${SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION}'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,schemaVersion}'='${PREDICTIVE_TERMINAL_RECEIPT_VERSION}'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,harnessSchemaVersion}'='${RESEARCH_HARNESS_ADMISSION_VERSION}'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,scoringContractVersion}'='${TERMINAL_SCORING_CONTRACT}'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,scoringMetric}'='${TERMINAL_SCORING_METRIC}'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,scoringAmendmentDigestHex}'=
          '${TERMINAL_SCORING_AMENDMENT_DIGEST}'`;
    expect(nextPolicy).toBe(policy.replace("AND schema_version='scientific-admission-receipt/v2'", newBoundary));
    const journal = JSON.parse(readFileSync("db/migrations_postgres/meta/_journal.json", "utf8"));
    expect(journal.entries.find((e: {idx: number}) => e.idx === 206)).toMatchObject({ idx: 206, tag: "0206_historical_brier_admission_v3" });
  });
});
