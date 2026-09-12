import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CDF_ERF_CODY715_VERSION, CDF_REFERENCE_AMENDMENT_DIGEST } from "@/lib/trader/research/benchmark/cdf-evidence-protocol-v2";
import { PREDICTIVE_TERMINAL_RECEIPT_VERSION, SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { RESEARCH_HARNESS_ADMISSION_VERSION } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";

describe("DEE-993 protocol-only migration delta", () => {
  it("preserves 0206 completely except exact CDF protocol predicates", () => {
    const before=readFileSync("db/migrations_postgres/0206_historical_brier_admission_v3.sql","utf8");
    const after=readFileSync("db/migrations_postgres/0207_historical_cody_admission_v4.sql","utf8");
    const expected=before.slice(before.indexOf("DROP POLICY"))
      .replace("schema_version='scientific-admission-receipt/v3'",`schema_version='${SCIENTIFIC_ADMISSION_RECEIPT_V2_VERSION}'`)
      .replace("='predictive-terminal-receipt/v2'",`='${PREDICTIVE_TERMINAL_RECEIPT_VERSION}'`)
      .replace("='research-harness-admission/v4'",`='${RESEARCH_HARNESS_ADMISSION_VERSION}'`)
      .replace("        AND selected_k_config_dec IS NOT NULL",
        `        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,cdfKernelVersion}'='${CDF_ERF_CODY715_VERSION}'
        AND receipt_json::jsonb#>>'{predictiveTerminalReceipt,cdfAmendmentDigestHex}'=
          '${CDF_REFERENCE_AMENDMENT_DIGEST}'
        AND selected_k_config_dec IS NOT NULL`);
    expect(after.slice(after.indexOf("DROP POLICY")).trim()).toBe(expected.trim());
    const journal=JSON.parse(readFileSync("db/migrations_postgres/meta/_journal.json","utf8"));
    expect(journal.entries.at(-1)).toMatchObject({idx:207,tag:"0207_historical_cody_admission_v4"});
  });
});
