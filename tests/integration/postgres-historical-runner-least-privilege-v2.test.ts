import { createHash, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assumeHistoricalSimulationRunnerRoleV2,
  requireHistoricalSimulationRunnerLoginV2,
  resetHistoricalSimulationRunnerRoleV2,
  runHistoricalSimulationLaunchConsumerCliV2,
} from "@/lib/trader/historical-simulation-v2/launch-consumer-cli-v2";
import { buildHistoricalSimulationRunLifecycleEventV2 } from
  "@/lib/trader/historical-simulation-v2/run-lifecycle-v2";
import { provisionHistoricalRunnerLoginV2 } from
  "../../scripts/ops/provision-historical-runner-login.mjs";
import { registerManagedHistoricalRoleTests } from "./postgres-managed-historical-role-v2.cases";

const enabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();
const ROLE = "waia_historical_runner";
const LOGIN_ROLE = "waia_historical_runner_login";
const AUTHORIZED_ORGANIZATION = "3c50b4e9-1138-43a5-a29f-e65088124cfc";
const provisioningEnabled = process.env.WAIA_PG_INTEGRATION_ROLE_PROVISIONING === "1";
const provisioningAdminUrl = process.env.WAIA_POSTGRES_ADMIN_SESSION_URL?.trim();
const provisioningPassword = process.env.WAIA_HISTORICAL_RUNNER_DB_PASSWORD;

registerManagedHistoricalRoleTests(enabled, url);

const requiredPrivileges = new Map<string, readonly string[]>([
  ["trader_historical_simulation_run_lifecycle_event_v2", ["INSERT", "SELECT"]],
  ["trader_historical_simulation_run_start_v2", ["INSERT", "SELECT"]],
  ["trader_historical_simulation_policy_config_v2", ["INSERT", "SELECT"]],
  ["trader_historical_simulation_reason_ledger_v2", ["INSERT", "SELECT"]],
  ["trader_historical_simulation_atomic_stage_v2", ["INSERT", "SELECT"]],
  ["trader_historical_simulation_resume_checkpoint_v2", ["INSERT", "SELECT"]],
  ["trader_forecast_v2", ["INSERT", "SELECT"]],
  ["trader_forecast_runtime_input_source_v2", ["INSERT", "SELECT"]],
  ["trader_required_information_profile_v2", ["INSERT", "SELECT"]],
  ["trader_information_sufficiency_receipt_v2", ["INSERT", "SELECT"]],
  ["trader_forecast_pit_bar_v2", ["INSERT", "SELECT"]],
  ["trader_forecast_outcome_v2", ["INSERT", "SELECT"]],
  ["trader_forecast_calibration_observation_v2", ["INSERT", "SELECT"]],
  ["trader_knowledge_confidence_update_record", ["INSERT", "SELECT"]],
  ["trader_knowledge_state_checkpoint_v2", ["INSERT", "SELECT"]],
  ["trader_orders", ["INSERT", "SELECT"]],
  ["trader_order_events", ["INSERT", "SELECT"]],
  ["trader_fills", ["INSERT", "SELECT"]],
  ["trader_fill_execution_economics", ["INSERT", "SELECT"]],
  ["trader_accounting_frontier", ["INSERT", "SELECT"]],
]);

const requiredUpdateColumns = new Map<string, readonly string[]>([
  ["trader_knowledge_edges", [
    "confidence", "failure_cases_json", "hypothesis_id", "regime_scope", "strength",
    "updated_at", "verified",
  ]],
  ["trader_market_predictions", ["outcome_json", "verification_result", "verified_at"]],
  ["trader_orders", [
    "avg_fill_price", "exchange_order_id", "filled_quantity", "state", "state_version",
    "updated_at",
  ]],
]);

describe.skipIf(!enabled || !url)("Postgres Historical V2 runner least privilege", () => {
  let sql: postgres.Sql;
  let createdOrganization = false;
  const fixtureUserId = randomUUID();
  const fullSealedProbeId = randomUUID();

  beforeAll(async () => {
    sql = postgres(url!, { max: 1 });
    const existing = await sql<{ present: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM organizations WHERE id=${AUTHORIZED_ORGANIZATION}::uuid
      ) AS present
    `;
    if (!existing[0]?.present) {
      await sql`INSERT INTO auth.users (id) VALUES (${fixtureUserId}::uuid)`;
      await sql`INSERT INTO users (id,identity_label,email)
        VALUES (${fixtureUserId}::uuid,'Historical runner role probe',
          ${`historical-runner-${fixtureUserId}@invalid.local`})`;
      await sql`INSERT INTO organizations (id,owner_user_id,kind,name)
        VALUES (${AUTHORIZED_ORGANIZATION}::uuid,${fixtureUserId}::uuid,'personal',
          'Historical runner role probe')`;
      createdOrganization = true;
    }
  });
  afterAll(async () => {
    if (!sql) return;
    if (createdOrganization) {
      await sql`DELETE FROM organizations WHERE id=${AUTHORIZED_ORGANIZATION}::uuid`;
      await sql`DELETE FROM users WHERE id=${fixtureUserId}::uuid`;
      await sql`DELETE FROM auth.users WHERE id=${fixtureUserId}::uuid`;
    }
    await sql.end({ timeout: 5 });
  });

  it("recomputes the legacy Human receipt digest with exact JSON.stringify bytes", async () => {
    const body = {
      schemaVersion: "epistemic-parameter-ratification/v1",
      verdict: "RATIFIED",
      kmConvergenceEvidenceSemanticDigestHex: "1".repeat(64),
      selectedK: 3,
      selectedM: 5,
      alphaEpiConfigScale8: "0.12500000",
      selectedPackageGenerationIdentityDigestHex: "2".repeat(64),
      selectedPackageContentDigestHex: "3".repeat(64),
      humanReceiptIdentityDigestHex: "4".repeat(64),
    } as const;
    const contentDigestHex = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const receipt = { ...body, contentDigestHex };
    const rows = await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
      return tx<Array<Readonly<{ digest: string | null; forged_digest: string | null }>>>`
        SELECT
          public.waia_epistemic_parameter_ratification_v1_content_digest_hex(
            ${tx.json(receipt)}::jsonb) AS digest,
          public.waia_epistemic_parameter_ratification_v1_content_digest_hex(
            (${tx.json(receipt)}::jsonb || '{"selectedK":4}'::jsonb)) AS forged_digest
      `;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.digest).toBe(contentDigestHex);
    expect(rows[0]?.forged_digest).not.toBe(contentDigestHex);
  });

  it("locates an exact convergence JSONB mismatch at the first configuration field", async () => {
    const convergence = {
      schemaVersion: "km-convergence-receipt/v1",
      configurations: [{ kConfig: 10, mConfig: 20, qualifies: true,
        evLowerRelativeErrorP95: 0.0005645000000001134 }],
      selectedK: 10,
      selectedM: 20,
    };
    const forged = structuredClone(convergence);
    forged.configurations[0]!.evLowerRelativeErrorP95 = 0.0005645000000002134;
    const rows = await sql<Array<Readonly<{
      raw_equal: boolean;
      canonical_equal: boolean;
      first_top_level_diff: string | null;
      first_configuration_diff: string | null;
      left_configuration_value: string | null;
      right_configuration_value: string | null;
    }>>>`
      WITH pair AS (
        SELECT ${sql.json(convergence)}::jsonb AS left_receipt,
          ${sql.json(forged)}::jsonb AS right_receipt
      )
      SELECT
        left_receipt IS NOT DISTINCT FROM right_receipt AS raw_equal,
        public.waia_canonical_jsonb_v1(left_receipt)
          IS NOT DISTINCT FROM public.waia_canonical_jsonb_v1(right_receipt)
          AS canonical_equal,
        top_diff.key AS first_top_level_diff,
        configuration_diff.path AS first_configuration_diff,
        configuration_diff.left_value AS left_configuration_value,
        configuration_diff.right_value AS right_configuration_value
      FROM pair
      LEFT JOIN LATERAL (
        SELECT key
        FROM (
          SELECT jsonb_object_keys(left_receipt) AS key
          UNION SELECT jsonb_object_keys(right_receipt) AS key
        ) keys
        WHERE left_receipt->key IS DISTINCT FROM right_receipt->key
        ORDER BY key LIMIT 1
      ) top_diff ON true
      LEFT JOIN LATERAL (
        SELECT
          format('configurations[%s].%s', left_entry.ordinality - 1, keys.key) AS path,
          (left_entry.value->keys.key)::text AS left_value,
          (right_entry.value->keys.key)::text AS right_value
        FROM jsonb_array_elements(left_receipt->'configurations')
          WITH ORDINALITY left_entry(value, ordinality)
        LEFT JOIN LATERAL (
          SELECT value
          FROM jsonb_array_elements(right_receipt->'configurations')
            WITH ORDINALITY candidate(value, ordinality)
          WHERE candidate.ordinality=left_entry.ordinality
        ) right_entry ON true
        CROSS JOIN LATERAL (
          SELECT jsonb_object_keys(COALESCE(left_entry.value, '{}'::jsonb)) AS key
          UNION SELECT jsonb_object_keys(COALESCE(right_entry.value, '{}'::jsonb)) AS key
        ) keys
        WHERE left_entry.value->keys.key IS DISTINCT FROM right_entry.value->keys.key
        ORDER BY left_entry.ordinality, keys.key LIMIT 1
      ) configuration_diff ON true
    `;
    expect(rows).toEqual([{
      raw_equal: false,
      canonical_equal: false,
      first_top_level_diff: "configurations",
      first_configuration_diff: "configurations[0].evLowerRelativeErrorP95",
      left_configuration_value: "0.0005645000000001134",
      right_configuration_value: "0.0005645000000002134",
    }]);
  });

  it("keeps the actual database role unprivileged and outside every inherited role", async () => {
    const roles = await sql<Array<Readonly<{
      rolcanlogin: boolean; rolinherit: boolean; rolsuper: boolean; rolbypassrls: boolean;
      rolcreaterole: boolean; rolcreatedb: boolean; rolreplication: boolean;
      memberships: number;
    }>>>`
      SELECT r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolbypassrls,r.rolcreaterole,r.rolcreatedb,
        r.rolreplication,
        (SELECT count(*)::integer FROM pg_auth_members m WHERE m.member=r.oid) AS memberships
      FROM pg_roles r WHERE r.rolname=${ROLE}
    `;
    expect(roles).toEqual([{ rolcanlogin: false, rolinherit: false, rolsuper: false,
      rolbypassrls: false, rolcreaterole: false, rolcreatedb: false,
      rolreplication: false, memberships: 0 }]);
  });

  it("exposes only SELECT/INSERT at table level and exact UPDATE columns", async () => {
    const grants = await sql<Array<Readonly<{ table_schema: string; table_name: string;
      privilege_type: string }>>>`
      SELECT table_schema,table_name,privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee=${ROLE}
      ORDER BY table_schema,table_name,privilege_type
    `;
    expect(grants.length).toBeGreaterThan(requiredPrivileges.size);
    expect(new Set(grants.map((row) => row.privilege_type)))
      .toEqual(new Set(["INSERT", "SELECT"]));
    for (const [table, privileges] of requiredPrivileges) {
      expect(grants.filter((row) => row.table_schema === "public" && row.table_name === table)
        .map((row) => row.privilege_type)).toEqual(privileges);
    }
    expect(grants.filter((row) => row.table_schema === "drizzle"))
      .toEqual([{ table_schema: "drizzle", table_name: "__drizzle_migrations",
        privilege_type: "SELECT" }]);
    expect(grants.some((row) => /credential|live_enable/.test(row.table_name))).toBe(false);
    expect(grants.some((row) => row.table_name === "organization_members")).toBe(false);
    expect(grants.some((row) => /trader_(risk|execution|reality)_(verdict|allowance|plan|attempt|report|truth)/
      .test(row.table_name))).toBe(false);

    const updateColumns = await sql<Array<Readonly<{ table_name: string; column_name: string }>>>`
      SELECT table_name,column_name
      FROM information_schema.column_privileges
      WHERE grantee=${ROLE} AND table_schema='public' AND privilege_type='UPDATE'
      ORDER BY table_name,column_name
    `;
    expect([...new Set(updateColumns.map((row) => row.table_name))])
      .toEqual([...requiredUpdateColumns.keys()]);
    for (const [table, columns] of requiredUpdateColumns) {
      expect(updateColumns.filter((row) => row.table_name === table)
        .map((row) => row.column_name)).toEqual(columns);
    }

    const publicTables = [...new Set(grants.filter((row) => row.table_schema === "public")
      .map((row) => row.table_name))];
    const policies = await sql<Array<Readonly<{ tablename: string; cmd: string; roles: string[];
      qual: string | null; with_check: string | null }>>>`
      SELECT tablename,cmd,roles,qual,with_check FROM pg_policies
      WHERE schemaname='public' AND ${ROLE}=ANY(roles)
    `;
    for (const table of publicTables) {
      const tableGrants = new Set(grants.filter((row) => row.table_schema === "public" && row.table_name === table)
        .map((row) => row.privilege_type));
      const tablePolicies = policies.filter((row) => row.tablename === table);
      if (tableGrants.has("SELECT")) expect(tablePolicies.some((row) =>
        (row.cmd === "SELECT" || row.cmd === "ALL") &&
        row.qual?.includes(AUTHORIZED_ORGANIZATION))).toBe(true);
      if (tableGrants.has("INSERT")) expect(tablePolicies.some((row) =>
        (row.cmd === "INSERT" || row.cmd === "ALL") &&
        row.with_check?.includes(AUTHORIZED_ORGANIZATION))).toBe(true);
      if (tableGrants.has("UPDATE")) expect(tablePolicies.some((row) =>
        (row.cmd === "UPDATE" || row.cmd === "ALL") &&
        row.qual?.includes(AUTHORIZED_ORGANIZATION) &&
        row.with_check?.includes(AUTHORIZED_ORGANIZATION))).toBe(true);
    }
    const datasetPolicies = policies.filter((row) =>
      row.tablename === "trader_historical_dataset_authority_v2",
    );
    expect(datasetPolicies.find((row) => row.cmd === "SELECT")?.qual)
      .toContain("PRE_HOLDOUT_QUALIFICATION_V1");
    expect(datasetPolicies.find((row) => row.cmd === "INSERT")?.with_check)
      .toContain("PRE_HOLDOUT_QUALIFICATION_V1");
  });

  it("executes as the real runner role while RLS hides every other organization", async () => {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
      const identity = await tx<{ current_user: string }[]>`SELECT current_user`;
      expect(identity[0]?.current_user).toBe(ROLE);
      const grantedTables = await tx<{ table_name: string }[]>`
        SELECT DISTINCT table_name
        FROM information_schema.role_table_grants
        WHERE grantee=${ROLE} AND table_schema='public' AND privilege_type='SELECT'
        ORDER BY table_name
      `;
      for (const { table_name: table } of grantedTables) {
        const rows = await tx.unsafe<{ count: string }[]>(
          `SELECT count(*)::text AS count FROM public.${table} WHERE organization_id <> $1::uuid`,
          [AUTHORIZED_ORGANIZATION],
        );
        expect(rows[0]?.count).toBe("0");
      }
      const migrationRows = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations
      `;
      expect(Number(migrationRows[0]?.count ?? "0")).toBeGreaterThanOrEqual(200);
    });
  });

  it("reads the immutable first/next-cycle surface without UPDATE-strength locks", async () => {
    const relations = [
      "trader_historical_four_surface_ratified_admission_v2",
      "trader_scientific_admission_receipt_v1",
      "trader_historical_dataset_authority_v2",
      "trader_historical_forecast_input_pit_v2",
      "trader_historical_simulation_run_start_v2",
      "trader_historical_simulation_resume_checkpoint_v2",
      "trader_dee659_authority_preregistration_v2",
      "trader_forecast_bundle_v2",
      "trader_forecast_v2",
      "trader_forecast_runtime_input_source_v2",
      "trader_forecast_contract_binding_v1",
      "trader_knowledge_confidence_update_record",
      "trader_accounting_frontier",
    ] as const;
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
      for (const relation of relations) {
        await expect(tx.unsafe(`SELECT 1 FROM public.${relation} WHERE false`))
          .resolves.toEqual([]);
        const privileges = await tx<Array<Readonly<{ can_update: boolean }>>>`
          SELECT has_table_privilege(current_user,${`public.${relation}`},'UPDATE')
            AS can_update
        `;
        expect(privileges).toEqual([{ can_update: false }]);
      }
    });
  });

  it("hides final authority for both an unapproved run and a foreign organization", async () => {
    const probeUserId = randomUUID();
    const foreignOrganizationId = randomUUID();
    const rollbackProbe = Symbol("rollback unapproved final-authority probes");
    const createdAt = "2026-09-04T12:00:00.000Z";
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO auth.users (id) VALUES (${probeUserId}::uuid)`;
        await tx`INSERT INTO users (id,identity_label,email) VALUES (
          ${probeUserId}::uuid,'Historical final authority RLS probe',
          ${`historical-authority-${probeUserId}@invalid.local`}
        )`;
        await tx`INSERT INTO organizations (id,owner_user_id,kind,name) VALUES (
          ${foreignOrganizationId}::uuid,${probeUserId}::uuid,'personal',
          'Foreign historical authority RLS probe'
        )`;
        const authorityIds: string[] = [];
        for (const [index, organizationId] of
          [AUTHORIZED_ORGANIZATION, foreignOrganizationId].entries()) {
          const aggregateId = randomUUID();
          const authorityId = randomUUID();
          const runId = `unapproved-authority-${index}-${randomUUID()}`;
          const aggregateDigest = createHash("sha256")
            .update(`aggregate:${runId}`).digest("hex");
          const authorityDigest = createHash("sha256")
            .update(`authority:${runId}`).digest("hex");
          const knowledgeDigest = createHash("sha256")
            .update(`knowledge:${runId}`).digest("hex");
          const marketDigest = createHash("sha256")
            .update(`market:${runId}`).digest("hex");
          await tx`INSERT INTO trader_scientific_admission_receipt_v1 (
            id,organization_id,receipt_kind,km_global_anchor_set_digest,
            replica_root_family_identity_digest,selected_k_config_dec,
            selected_m_config_dec,alpha_epi_config_scale8,
            selected_package_generation_identity_digest,
            selected_package_content_digest,evidence_semantic_digest,receipt_json,
            content_digest,schema_version,created_at
          ) VALUES (
            ${aggregateId}::uuid,${organizationId}::uuid,'FOUR_SURFACE',${"1".repeat(64)},
            ${"2".repeat(64)},NULL,NULL,'0.00000000',NULL,NULL,
            ${createHash("sha256").update(`evidence:${runId}`).digest("hex")},'{}',
            ${aggregateDigest},'scientific-admission-four-surface/v2',${createdAt}::timestamptz
          )`;
          const authority = {
            schemaVersion: "waia.trader.historical_four_surface_ratified_admission.v2",
            organizationId,
            runId,
            releaseSha: "a".repeat(40),
            aggregateAdmissionReceiptId: aggregateId,
            aggregateAdmissionContentDigestHex: aggregateDigest,
            developmentDatasetIdentityDigestHex: "3".repeat(64),
            operatorUserId: probeUserId,
            operatorMemberRole: "owner",
            executionExtent: { initialRecordIndex: 525_600, cycleCount: 35 },
            surfaceAdmissions: [{}, {}, {}, {}],
            epistemicRecordCutoff: createdAt,
            knowledgeSnapshots: [{}, {}, {}, {}],
            knowledgeSnapshotDigestHex: knowledgeDigest,
            marketEvidence: [{}, {}],
            marketEvidenceDigestHex: marketDigest,
            authorityBoundary: {
              capitalAuthority: "NONE",
              liveTradingAuthority: "NONE",
              blindHoldoutAuthority: "FORBIDDEN_NOT_PRESENT_NOT_ACCESSED",
            },
            contentDigestHex: authorityDigest,
          };
          await tx`INSERT INTO trader_historical_four_surface_ratified_admission_v2 (
            id,organization_id,run_id,release_sha,aggregate_admission_receipt_id,
            aggregate_admission_content_digest_hex,development_dataset_identity_digest_hex,
            operator_user_id,surface_admissions_json,knowledge_snapshots_json,
            knowledge_snapshot_digest_hex,market_evidence_json,market_evidence_digest_hex,
            authority_json,authority_content_digest_hex,schema_version,created_at
          ) VALUES (
            ${authorityId}::uuid,${organizationId}::uuid,${runId},${authority.releaseSha},
            ${aggregateId}::uuid,${aggregateDigest},${authority.developmentDatasetIdentityDigestHex},
            ${probeUserId}::uuid,${tx.json(authority.surfaceAdmissions)},
            ${tx.json(authority.knowledgeSnapshots)},${knowledgeDigest},
            ${tx.json(authority.marketEvidence)},${marketDigest},${tx.json(authority)},
            ${authorityDigest},${authority.schemaVersion},${createdAt}::timestamptz
          )`;
          authorityIds.push(authorityId);
        }
        await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
        const hidden = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM trader_historical_four_surface_ratified_admission_v2
          WHERE id IN (${authorityIds[0]}::uuid,${authorityIds[1]}::uuid)
        `;
        expect(hidden).toEqual([{ count: "0" }]);
        throw rollbackProbe;
      });
    } catch (error) {
      if (error !== rollbackProbe) throw error;
    }
  });

  it("downgrades an owner session and refuses Human-semantic writes before exact approval", async () => {
    const runId = `role-probe-${randomUUID()}`;
    const releaseSha = "a".repeat(40);
    const result = await runHistoricalSimulationLaunchConsumerCliV2({
      WAIA_TRADER_CLI: "1",
      DATABASE_URL_POSTGRES_SESSION: url!,
      WAIA_RELEASE_SHA: releaseSha,
      WAIA_HISTORICAL_ORGANIZATION_ID: AUTHORIZED_ORGANIZATION,
      WAIA_HISTORICAL_RUN_ID: runId,
    }, {
      async openDatabase(databaseUrl) {
        const pool = postgres(databaseUrl, { max: 1 });
        const reserved = await pool.reserve();
        return {
          sql: reserved,
          async close() {
            reserved.release();
            await pool.end({ timeout: 5 });
          },
        };
      },
      assumeRunnerRole: assumeHistoricalSimulationRunnerRoleV2,
      resetRunnerRole: resetHistoricalSimulationRunnerRoleV2,
      createLifecycle: () => ({}) as never,
      async execute(input) {
        const identity = await input.sql<{ current_user: string }[]>`
          SELECT current_user::text AS current_user
        `;
        expect(identity).toEqual([{ current_user: ROLE }]);
        let deniedCode: string | undefined;
        try {
          await input.sql`INSERT INTO trader_knowledge_edges (
            id,organization_id,from_ref,to_ref,relation_kind,confidence,strength,
            regime_scope,failure_cases_json,verified
          ) VALUES (
            ${randomUUID()}::uuid,${AUTHORIZED_ORGANIZATION}::uuid,
            'preapproval-forbidden','preapproval-forbidden-result',
            'SUPPORTS','1','1','TEST_ONLY','[]',true
          )`;
        } catch (error) {
          deniedCode = (error as { code?: string }).code;
        }
        expect(deniedCode).toBe("42501");
        return buildHistoricalSimulationRunLifecycleEventV2({
          organizationId: AUTHORIZED_ORGANIZATION,
          accountId: "role-probe-account",
          runId,
          partition: "WALK_FORWARD",
          symbol: "BTCUSDT",
          eventSequence: 1,
          phase: "COMPLETED",
          initialRecordIndex: 0,
          terminalRecordIndexExclusive: 1,
          qualifiedTotalCycles: 1,
          committedCycles: 1,
          nextCycleSequence: 1,
          latestCommittedCycleId: "role-probe-cycle",
          requestedByOperatorId: "role-probe-operator",
          observedAt: "2026-09-04T09:00:00.000Z",
          errorCode: null,
          previousContentDigestHex: "b".repeat(64),
        });
      },
      releaseLease: async () => false,
    });
    expect(result.phase).toBe("COMPLETED");
  });

  it("refuses unscoped or non-mock orders before any approved historical run", async () => {
    for (const executionMode of ["live", "paper", "mock"] as const) {
      let code: string | undefined;
      try {
        await sql.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
          await tx`INSERT INTO trader_orders (
            id,organization_id,client_order_id,venue,symbol,side,type,
            quantity,execution_mode,state,idempotency_key,risk_decision_id,historical_run_id,
            historical_account_key
          ) VALUES (
            ${randomUUID()}::uuid,${AUTHORIZED_ORGANIZATION}::uuid,
            ${`forbidden-${randomUUID()}`},'historical-simulation','BTC/USDT','buy','market',
            '0.01',${executionMode}::order_execution_mode,'CREATED',
            ${`forbidden-${randomUUID()}`},'forbidden-risk-decision',
            ${executionMode === "mock" ? `unapproved-${randomUUID()}` : null},
            ${executionMode === "mock" ? "forbidden-account" : null}
          )`;
        });
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe("42501");
    }
  });

  it("refuses arbitrary Human-semantic scientific receipts outside an exact approved surface", async () => {
    const forged = {
      schemaVersion: "scientific-admission-receipt/v2",
      organizationId: AUTHORIZED_ORGANIZATION,
      wfPartition: "WF_PREDICTIVE",
      terminalStatus: "ADMITTED",
      predictiveTerminalReceipt: {},
      kmConvergenceReceipt: {},
      epistemicParameterRatificationReceipt: {},
      evidenceSemanticDigestHex: "1".repeat(64),
      contentDigestHex: "2".repeat(64),
    };
    let code: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
        await tx`INSERT INTO trader_scientific_admission_receipt_v1 (
          id,organization_id,receipt_kind,km_global_anchor_set_digest,
          replica_root_family_identity_digest,selected_k_config_dec,selected_m_config_dec,
          alpha_epi_config_scale8,selected_package_generation_identity_digest,
          selected_package_content_digest,evidence_semantic_digest,receipt_json,
          content_digest,schema_version
        ) VALUES (
          ${randomUUID()}::uuid,${AUTHORIZED_ORGANIZATION}::uuid,'WF_PREDICTIVE',
          ${"3".repeat(64)},${"4".repeat(64)},1,1,'0.10000000',
          ${"5".repeat(64)},${"6".repeat(64)},${forged.evidenceSemanticDigestHex},
          ${JSON.stringify(forged)},${forged.contentDigestHex},${forged.schemaVersion}
        )`;
      });
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("42501");
  });

  it("hides and refuses FULL_SEALED_DATASET_V2 inside the authorized organization", async () => {
    const runId = `full-sealed-role-probe-${randomUUID()}`;
    const cycleId = `${runId}:BLIND_HOLDOUT:BTCUSDT:0`;
    const datasetDigest = "a".repeat(64);
    const membershipDigest = "b".repeat(64);
    const sealedCycleDigest = "c".repeat(64);
    const authorityDigest = "d".repeat(64);
    const membership = {
      contentDigestHex: membershipDigest,
      datasetAuthorityClass: "FULL_SEALED_DATASET_V2",
      datasetAuthorityDigestHex: datasetDigest,
      sealReceiptDigestHex: datasetDigest,
      sealedCycleContentDigestHex: sealedCycleDigest,
      cycleId,
    };
    const sealedCycle = { contentDigestHex: sealedCycleDigest, cycleId };
    const rollbackProbe = Symbol("rollback FULL_SEALED visibility probe");
    try {
      await sql.begin(async (tx) => {
        await tx`INSERT INTO trader_historical_dataset_authority_v2 (
          id,organization_id,run_id,cycle_id,dataset_authority_digest_hex,
          dataset_authority_class,membership_content_digest_hex,
          sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,
          authority_content_digest_hex,schema_version
        ) VALUES (
          ${fullSealedProbeId}::uuid,${AUTHORIZED_ORGANIZATION}::uuid,${runId},${cycleId},
          ${datasetDigest},'FULL_SEALED_DATASET_V2',${membershipDigest},${sealedCycleDigest},
          ${tx.json(membership)},${tx.json(sealedCycle)},${authorityDigest},
          'waia.trader.historical_dataset_authority.v2'
        )`;
        await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
        const hidden = await tx<{ count: string }[]>`
          SELECT count(*)::text AS count
          FROM trader_historical_dataset_authority_v2
          WHERE id=${fullSealedProbeId}::uuid
        `;
        expect(hidden).toEqual([{ count: "0" }]);
        throw rollbackProbe;
      });
    } catch (error) {
      if (error !== rollbackProbe) throw error;
    }

    let insertCode: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
        const rejectedId = randomUUID();
        const rejectedRunId = `full-sealed-role-rejected-${randomUUID()}`;
        const rejectedCycleId = `${rejectedRunId}:BLIND_HOLDOUT:BTCUSDT:0`;
        await tx`INSERT INTO trader_historical_dataset_authority_v2 (
          id,organization_id,run_id,cycle_id,dataset_authority_digest_hex,
          dataset_authority_class,membership_content_digest_hex,
          sealed_cycle_content_digest_hex,membership_json,sealed_cycle_json,
          authority_content_digest_hex,schema_version
        ) VALUES (
          ${rejectedId}::uuid,${AUTHORIZED_ORGANIZATION}::uuid,
          ${rejectedRunId},${rejectedCycleId},${datasetDigest},
          'FULL_SEALED_DATASET_V2',${membershipDigest},${sealedCycleDigest},
          ${tx.json({ ...membership, cycleId: rejectedCycleId })},
          ${tx.json({ ...sealedCycle, cycleId: rejectedCycleId })},${authorityDigest},
          'waia.trader.historical_dataset_authority.v2'
        )`;
      });
    } catch (error) {
      insertCode = (error as { code?: string }).code;
    }
    expect(insertCode).toBe("42501");
  });

  it.each(["DELETE", "TRUNCATE"])("refuses %s under the real runner role", async (operation) => {
    let code: string | undefined;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${ROLE}`);
        await tx.unsafe(operation === "DELETE"
          ? "DELETE FROM public.trader_orders WHERE false"
          : "TRUNCATE TABLE public.trader_orders");
      });
    } catch (error) {
      code = (error as { code?: string }).code;
    }
    expect(code).toBe("42501");
  });
});

describe.skipIf(!enabled || !url || !provisioningEnabled || !provisioningAdminUrl ||
  !provisioningPassword)("Postgres Historical V2 dedicated LOGIN boundary", () => {
  let adminSql: postgres.Sql;
  const unexpectedMembershipRole = "waia_historical_runner_forbidden_probe";

  async function expectRuntimeLoginGuardDenied(): Promise<void> {
    const loginUrl = new URL(url!);
    loginUrl.username = LOGIN_ROLE;
    loginUrl.password = provisioningPassword!;
    const pool = postgres(loginUrl.toString(), { max: 1 });
    const reserved = await pool.reserve();
    try {
      await expect(requireHistoricalSimulationRunnerLoginV2(reserved))
        .rejects.toThrow("DATABASE_LOGIN_ROLE");
    } finally {
      reserved.release();
      await pool.end({ timeout: 5 });
    }
  }

  beforeAll(() => {
    adminSql = postgres(provisioningAdminUrl!, { max: 1 });
  });

  afterAll(async () => {
    if (!adminSql) return;
    await adminSql.unsafe("DROP TABLE IF EXISTS public.waia_historical_runner_ownership_probe");
    await adminSql.unsafe(`DROP ROLE IF EXISTS ${LOGIN_ROLE}`);
    await adminSql.unsafe(`DROP ROLE IF EXISTS ${unexpectedMembershipRole}`);
    await adminSql.end({ timeout: 5 });
  });

  it("provisions idempotently and enters the runner role only from the constrained login", async () => {
    const env = {
      WAIA_POSTGRES_ADMIN_SESSION_URL: provisioningAdminUrl,
      WAIA_HISTORICAL_RUNNER_DB_PASSWORD: provisioningPassword,
    };
    await expect(provisionHistoricalRunnerLoginV2(env)).resolves.toEqual({
      loginRole: LOGIN_ROLE,
      memberOf: ROLE,
    });
    await expect(provisionHistoricalRunnerLoginV2(env)).resolves.toEqual({
      loginRole: LOGIN_ROLE,
      memberOf: ROLE,
    });

    const loginUrl = new URL(url!);
    loginUrl.username = LOGIN_ROLE;
    loginUrl.password = provisioningPassword!;
    const pool = postgres(loginUrl.toString(), { max: 1 });
    const reserved = await pool.reserve();
    try {
      await expect(requireHistoricalSimulationRunnerLoginV2(reserved)).resolves.toBeUndefined();
      await assumeHistoricalSimulationRunnerRoleV2(reserved);
      const identity = await reserved<Array<Readonly<{
        session_user: string;
        current_user: string;
      }>>>`SELECT session_user::text AS session_user, current_user::text AS current_user`;
      expect(identity).toEqual([{ session_user: LOGIN_ROLE, current_user: ROLE }]);
      await resetHistoricalSimulationRunnerRoleV2(reserved);
    } finally {
      reserved.release();
      await pool.end({ timeout: 5 });
    }
  });

  it("rejects post-provisioning direct grants, object ownership, and extra memberships", async () => {
    const env = {
      WAIA_POSTGRES_ADMIN_SESSION_URL: provisioningAdminUrl,
      WAIA_HISTORICAL_RUNNER_DB_PASSWORD: provisioningPassword,
    };
    await provisionHistoricalRunnerLoginV2(env);

    await adminSql.unsafe(`GRANT SELECT ON public.organizations TO ${LOGIN_ROLE}`);
    try {
      await expect(provisionHistoricalRunnerLoginV2(env)).rejects.toThrow("DIRECT_GRANT");
      await expectRuntimeLoginGuardDenied();
    } finally {
      await adminSql.unsafe(`REVOKE SELECT ON public.organizations FROM ${LOGIN_ROLE}`);
    }

    await adminSql.unsafe("CREATE TABLE public.waia_historical_runner_ownership_probe (id integer)");
    await adminSql.unsafe(
      `ALTER TABLE public.waia_historical_runner_ownership_probe OWNER TO ${LOGIN_ROLE}`,
    );
    try {
      await expect(provisionHistoricalRunnerLoginV2(env)).rejects.toThrow("OBJECT_OWNERSHIP");
      await expectRuntimeLoginGuardDenied();
    } finally {
      await adminSql.unsafe("DROP TABLE public.waia_historical_runner_ownership_probe");
    }

    await adminSql.unsafe(
      `CREATE ROLE ${unexpectedMembershipRole} NOLOGIN NOINHERIT NOBYPASSRLS`,
    );
    await adminSql.unsafe(`GRANT ${unexpectedMembershipRole} TO ${LOGIN_ROLE}`);
    try {
      await expect(provisionHistoricalRunnerLoginV2(env))
        .rejects.toThrow("UNEXPECTED_MEMBERSHIP");
      await expectRuntimeLoginGuardDenied();
    } finally {
      await adminSql.unsafe(`REVOKE ${unexpectedMembershipRole} FROM ${LOGIN_ROLE}`);
      await adminSql.unsafe(`DROP ROLE ${unexpectedMembershipRole}`);
    }
  });
});
