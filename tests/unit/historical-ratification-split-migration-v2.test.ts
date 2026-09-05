import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync("db/migrations_postgres/0201_historical_ratification_split_v2.sql", "utf8");

describe("migration 0201 historical ratification split", () => {
  it("keeps request/proposal/ratification append-only and browser-denied", () => {
    expect(sql).toContain("trader_historical_ratification_request_v2");
    expect(sql).toContain("trader_historical_technical_proposal_v2");
    expect(sql).toContain("trader_historical_proposal_ratification_v2");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("FOR ALL TO authenticated, anon");
  });

  it("lets runner prepare/read a proposal but never insert Human approval or final authority", () => {
    expect(sql).toContain("FOR INSERT TO waia_historical_runner");
    expect(sql).toContain("trader_historical_technical_proposal_v2");
    expect(sql).not.toMatch(/GRANT\s+[^;]*INSERT[^;]*trader_historical_proposal_ratification_v2/is);
    expect(sql).not.toMatch(/GRANT\s+[^;]*INSERT[^;]*trader_historical_four_surface_ratified_admission_v2/is);
    expect(sql).toContain("historical_scientific_admission_runner_insert_v2");
  });

  it("binds every runner scientific receipt insert to an exact request or approved surface", () => {
    const policy = sql.slice(sql.lastIndexOf(
      "CREATE POLICY historical_scientific_admission_runner_insert_v2",
    ));
    expect(policy).toContain("receipt_kind='WF_PREDICTIVE_FOUR_SURFACE'");
    expect(policy).toContain("FROM public.trader_historical_ratification_request_v2 request");
    expect(policy).toContain("receipt_kind='WF_PREDICTIVE'");
    expect(policy).toContain("JOIN public.trader_historical_proposal_ratification_v2 approval");
    expect(policy).toContain("proposal.technical_candidate_json->'surfaces'");
    expect(policy).toContain(
      "aggregate.receipt_json::jsonb#>'{sourceAuthority,contract,surfaces}'",
    );
    expect(policy).toContain("humanReceiptIdentityDigestHex");
    expect(policy).toContain("waia_epistemic_parameter_ratification_v1_content_digest_hex");
    expect(policy).not.toMatch(
      /WHERE approval\.organization_id=\s*trader_scientific_admission_receipt_v1\.organization_id\s*\)/,
    );
  });

  it("exposes final authority only for the exact approved proposal", () => {
    expect(sql).toContain(
      "historical_four_surface_ratified_admission_v2_approved_runner_read",
    );
    expect(sql).toContain(
      "DROP POLICY IF EXISTS historical_four_surface_ratified_admission_v2_runner_read",
    );
    const policy = sql.match(
      /CREATE POLICY historical_four_surface_ratified_admission_v2_approved_runner_read[\s\S]*?\n\s*\);\n--> statement-breakpoint/,
    )?.[0];
    expect(policy).toBeDefined();
    expect(policy).toContain("JOIN public.trader_historical_proposal_ratification_v2 approval");
    expect(policy).toContain("approval.proposal_content_digest_hex=proposal.content_digest_hex");
    expect(policy).toContain("proposal.technical_candidate_json->>'aggregateAdmissionReceiptId'");
    expect(policy).toContain("aggregate_admission_content_digest_hex");
    expect(policy).not.toContain("current_user = 'waia_historical_runner'");
  });

  it("derives the bounded execution extent from canonical qualification evidence", () => {
    expect(sql).toContain("'initialRecordIndex')::integer) >= 239");
    expect(sql).toContain("trader_historical_qualified_execution_extent_v2");
    expect(sql).toContain("waia_historical_qualification_extent_matches_v2");
    expect(sql).toContain("qualification_receipt_json-'qualificationReceiptDigest'");
    expect(sql).toContain("technical proposal extent exceeds qualified WF_ECONOMIC partition");
    expect(sql).toContain("qualified.first_economic_record_index");
    expect(sql).toContain("qualified.economic_record_count");
  });

  it("binds self-sealed final evidence back to canonical database records", () => {
    expect(sql).toContain("waia_finalize_historical_four_surface_authority_v2");
    expect(sql).toContain("FROM public.trader_mi_hypothesis h");
    expect(sql).toContain("JOIN public.trader_market_predictions prediction");
    expect(sql).toContain("JOIN public.trader_knowledge_edges edge");
    expect(sql).toContain("FROM public.trader_historical_dataset_authority_v2 dataset");
    expect(sql).toContain("JOIN public.trader_mi_observation observation");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.waia_finalize");
    expect(sql).toContain("TO waia_historical_runner");
  });

  it("rejects caller-shaped or future-dated final authority and limits mutable columns", () => {
    expect(sql).toContain("'AUTHORITY_EXACT_SHAPE'");
    expect(sql).toContain("'AUTHORITY_NESTED_SHAPE'");
    expect(sql).toContain("'AUTHORITY_SURFACE_EXACT_SHAPE'");
    expect(sql).toContain("'AUTHORITY_EPISTEMIC_CUTOFF'");
    expect(sql).toContain("approval_row.created_at");
    expect(sql).toContain("clock_timestamp()");
    expect(sql).toContain("REVOKE UPDATE ON TABLE public.trader_orders");
    expect(sql).toContain("GRANT UPDATE (state,state_version,filled_quantity,avg_fill_price,exchange_order_id,updated_at)");
    expect(sql).toContain("REVOKE UPDATE ON TABLE public.trader_market_predictions");
    expect(sql).toContain("GRANT UPDATE (outcome_json,verification_result,verified_at)");
    expect(sql).toContain("REVOKE UPDATE ON TABLE public.trader_knowledge_edges");
  });

  it("permits only the exact approved neutral Forecast package edge", () => {
    const selectPolicy = sql.match(
      /CREATE POLICY waia_historical_approved_neutral_package_select_v2[\s\S]*?\n\s*\)\);\nDROP POLICY IF EXISTS waia_historical_approved_neutral_package_insert_v2/,
    )?.[0];
    const insertPolicy = sql.match(
      /CREATE POLICY waia_historical_approved_neutral_package_insert_v2[\s\S]*?\n\s*\)\);\n--> statement-breakpoint/,
    )?.[0];
    for (const policy of [selectPolicy, insertPolicy]) {
      expect(policy).toBeDefined();
      expect(policy).toContain("hypothesis_id IS NULL");
      expect(policy).toContain("relation_kind='predictive_package_models_symbol_horizon'");
      expect(policy).toContain("confidence='0.50000000' AND strength='0.00000000'");
      expect(policy).toContain("regime_scope='ALL' AND failure_cases_json='[]' AND verified=false");
      expect(policy).toContain("JOIN public.trader_historical_proposal_ratification_v2 approval");
      expect(policy).toContain("JOIN public.trader_historical_four_surface_ratified_admission_v2 authority");
      expect(policy).toContain("proposal.technical_candidate_json->'surfaces'");
      expect(policy).toContain("authority.authority_json->'surfaceAdmissions'");
      expect(policy).not.toContain("candidate.surface->'predictiveTerminalReceipt'");
      expect(policy).toContain("(candidate.surface->>'symbol')");
      expect(policy).toContain("(candidate.surface->>'executionHorizonMinutes')");
      expect(policy).toContain("(admitted.surface->>'predictivePackageContentDigestHex')");
    }
    expect(sql).toContain("'TECHNICAL_CANDIDATE_SURFACE_EXACT_SHAPE'");
    expect(sql).toContain("'executionHorizonMinutes','familyIdentityDigestHex'");
    expect(sql).toContain("(c->>'primaryHorizonMinutes')::integer + 3");
    expect(sql).not.toContain(
      "CREATE POLICY waia_historical_approved_neutral_package_update_v2",
    );
  });

  it("exposes only an exact approval-bound membership assertion to the runner", () => {
    expect(sql).toContain("waia_historical_approved_operator_role_v2");
    expect(sql).toContain("proposal.request_id=request.id");
    expect(sql).toContain("approval.proposal_id=proposal.id");
    expect(sql).toContain("REVOKE ALL PRIVILEGES ON TABLE public.organization_members");
    expect(sql).toContain("FROM waia_historical_runner");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.waia_historical_approved_operator_role_v2");
  });

  it("uses unambiguous jsonb deletion operators in the executable finalizer", () => {
    expect(sql).toContain("proposal_row.launch_plan_json::jsonb -");
    expect(sql).toContain("ARRAY['accountId','symbol','primaryHorizonMinutes','startingCashUsdt',");
    expect(sql).toContain("p_authority - 'contentDigestHex'::text");
    expect(sql).toContain("k - 'snapshotContentDigestHex'::text");
    expect(sql).toContain("e - 'contentDigestHex'::text");
  });

  it("reconstructs the legacy V1 Human receipt digest in exact JSON.stringify order", () => {
    expect(sql).toContain("waia_epistemic_parameter_ratification_v1_content_digest_hex");
    expect(sql).toContain("'{\"schemaVersion\":'");
    expect(sql).toContain("',\"kmConvergenceEvidenceSemanticDigestHex\":'");
    expect(sql).toContain("',\"selectedK\":'");
    expect(sql).toContain("',\"humanReceiptIdentityDigestHex\":'");
    expect(sql).not.toMatch(
      /waia_canonical_jsonb_v1\(\s*\(a->'humanRatificationReceipt'\)/s,
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION\s+public\.waia_epistemic_parameter_ratification_v1_content_digest_hex\(jsonb\)\s+TO waia_historical_runner;/s,
    );
  });

  it("reports the exact final-authority header binding that failed", () => {
    for (const code of [
      "AUTHORITY_SCOPE",
      "AUTHORITY_EXACT_SHAPE",
      "AUTHORITY_NESTED_SHAPE",
      "AUTHORITY_SURFACE_EXACT_SHAPE",
      "AUTHORITY_KNOWLEDGE_EXACT_SHAPE",
      "AUTHORITY_MARKET_EXACT_SHAPE",
      "AUTHORITY_EPISTEMIC_CUTOFF",
      "AUTHORITY_AGGREGATE_BINDING",
      "AUTHORITY_EXECUTION_EXTENT",
      "AUTHORITY_QUALIFIED_EXTENT",
      "AUTHORITY_BOUNDARY",
      "AUTHORITY_CARDINALITY",
      "AUTHORITY_CONTENT_DIGEST",
      "AUTHORITY_KNOWLEDGE_SET_DIGEST",
      "AUTHORITY_MARKET_SET_DIGEST",
      "SCIENTIFIC_ROW_IDENTITY",
      "SCIENTIFIC_RECEIPT_DIGESTS",
      "SCIENTIFIC_PREDICTIVE_TERMINAL",
      "SCIENTIFIC_CONVERGENCE_RECEIPT",
      "SCIENTIFIC_HUMAN_CONVERGENCE_DIGEST",
      "SCIENTIFIC_HUMAN_SELECTED_KM",
      "SCIENTIFIC_HUMAN_ALPHA",
      "SCIENTIFIC_GLOBAL_ANCHOR",
      "SCIENTIFIC_FAMILY_IDENTITY",
      "SCIENTIFIC_SELECTED_PACKAGE",
      "SCIENTIFIC_HUMAN_IDENTITY",
      "SCIENTIFIC_HUMAN_CONTENT_DIGEST",
    ]) expect(sql).toContain(`'${code}'`);
    expect(sql).not.toContain("'SCIENTIFIC_SURFACE_DURABLE_BINDING'");
  });

  it("compares the persisted and frozen convergence receipts by the sealed semantic contract", () => {
    expect(sql).toContain(
      "s.receipt_json::jsonb->'kmConvergenceReceipt') IS NOT DISTINCT FROM",
    );
    expect(sql).toContain(
      "public.waia_canonical_jsonb_v1(frozen.value->'convergenceReceipt')",
    );
    expect(sql).toContain(
      ") candidate(value) ON candidate.value->>'surfaceKey'=a->>'surfaceKey'",
    );
    expect(sql).toContain(
      ") frozen(value) ON aggregate.id IS NOT NULL",
    );
    expect(sql).not.toContain(
      "s.receipt_json::jsonb->'kmConvergenceReceipt'=frozen.value->'convergenceReceipt'",
    );
  });
});
