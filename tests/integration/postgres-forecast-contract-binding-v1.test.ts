import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";

import {
  assessForecastContractAdmissionV1,
  buildForecastContractBindingRecordV1,
  ForecastContractBindingConflictError,
  persistForecastContractBindingV1,
  readForecastContractBindingV1,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-binding-service-v1";
import {
  buildForecastInputContractV2,
  buildForecastModelArtifactV2,
  buildForecastModelSpecV2,
} from "@/lib/trader/intelligence/forecast-v2/forecast-contract-foundation-v2";

import { cleanupWp13Org, seedWp13User } from "./wp13-intelligence-test-helpers";

const USER_A = "00000000-0000-4000-8000-000000064801";
const USER_B = "00000000-0000-4000-8000-000000064802";
const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

const hex64 = (seed: string) => createHash("sha256").update(seed, "utf8").digest("hex");

function contracts(seed = "base") {
  const inputContract = buildForecastInputContractV2({
    measurementSemanticVersion: "realized-volatility-20m-from-1m/v2",
    hypothesisAssessmentSchemaVersion: "waia.trader.hypothesis_assessment.v1",
  });
  const modelSpec = buildForecastModelSpecV2({
    modelId: "rv-state-conditional-empirical-joint/v1",
    modelTransformVersion: "rv-state-conditional-empirical-joint/v1",
    inputContractDigestHex: inputContract.contentDigestHex,
    terminalTargetDefinitionDigestHex: hex64("terminal"),
    executionOpportunityTargetDefinitionDigestHex: hex64("execopp"),
  });
  const modelArtifact = buildForecastModelArtifactV2({
    modelSpecDigestHex: modelSpec.contentDigestHex,
    inputContractDigestHex: inputContract.contentDigestHex,
    developmentDatasetDigestHex: hex64("development"),
    runtimeContractDigestHex: hex64("runtime"),
    artifactPayloadDigestHex: hex64(`payload-${seed}`),
  });
  return { inputContract, modelSpec, modelArtifact };
}

describe.skipIf(!integrationEnabled || !url)(
  "postgres Forecast V2 contract binding (DEE-746)",
  () => {
    let sql: postgres.Sql;
    let orgA: string;
    let orgB: string;
    let receiptId: string;
    const receiptDigest = hex64("scientific-receipt");
    const packageDigest = hex64("selected-package");

    async function toggleDeleteTriggers(enabled: boolean) {
      const verb = enabled ? "ENABLE" : "DISABLE";
      for (const [table, trigger] of [
        ["trader_forecast_contract_binding_v1", "trader_forecast_contract_binding_v1_block_delete"],
        ["trader_scientific_admission_receipt_v1", "trader_scientific_admission_receipt_v1_block_delete"],
      ] as const) await sql.unsafe(`ALTER TABLE ${table} ${verb} TRIGGER ${trigger}`);
    }

    async function cleanupRows() {
      await toggleDeleteTriggers(false);
      await sql`DELETE FROM trader_forecast_contract_binding_v1 WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)`;
      await sql`DELETE FROM trader_scientific_admission_receipt_v1 WHERE organization_id IN (${orgA}::uuid, ${orgB}::uuid)`;
      await toggleDeleteTriggers(true);
    }

    async function seedScientificReceipt() {
      receiptId = randomUUID();
      await sql`
        INSERT INTO trader_scientific_admission_receipt_v1 (
          id, organization_id, receipt_kind, km_global_anchor_set_digest,
          replica_root_family_identity_digest, selected_k_config_dec, selected_m_config_dec,
          alpha_epi_config_scale8, selected_package_generation_identity_digest,
          selected_package_content_digest, evidence_semantic_digest, receipt_json,
          content_digest, schema_version
        ) VALUES (
          ${receiptId}::uuid, ${orgA}::uuid, 'WF_PREDICTIVE', ${hex64("anchor")},
          ${hex64("family")}, 10, 20, '0.10000000', ${hex64("package-generation")},
          ${packageDigest}, ${hex64(`evidence-${receiptId}`)}, '{}', ${receiptDigest},
          'scientific-admission-receipt/v2'
        )
      `;
    }

    function record(organizationId = orgA, seed = "base") {
      const { inputContract, modelSpec, modelArtifact } = contracts(seed);
      return buildForecastContractBindingRecordV1({
        organizationId,
        scientificAdmissionReceiptId: receiptId,
        scientificAdmissionReceiptContentDigestHex: receiptDigest,
        selectedPredictivePackageContentDigestHex: packageDigest,
        inputContract,
        modelSpec,
        modelArtifact,
      });
    }

    beforeAll(async () => {
      sql = postgres(url!, { max: 4 });
      await toggleDeleteTriggers(false);
      await cleanupWp13Org(url!, USER_A);
      await cleanupWp13Org(url!, USER_B);
      await toggleDeleteTriggers(true);
      orgA = await seedWp13User(url!, USER_A, "Forecast Contract A");
      orgB = await seedWp13User(url!, USER_B, "Forecast Contract B");
    });

    beforeEach(async () => {
      await cleanupRows();
      await seedScientificReceipt();
    });

    afterAll(async () => {
      await cleanupRows();
      await sql.end({ timeout: 10 });
      await cleanupWp13Org(url!, USER_A);
      await cleanupWp13Org(url!, USER_B);
    });

    it("classifies a legacy or missing binding as NOT_ADMITTED", async () => {
      const c = contracts();
      await expect(
        assessForecastContractAdmissionV1(sql, {
          organizationId: orgA,
          selectedPredictivePackageContentDigestHex: packageDigest,
          inputContractDigestHex: c.inputContract.contentDigestHex,
          modelSpecDigestHex: c.modelSpec.contentDigestHex,
          modelArtifactDigestHex: c.modelArtifact.contentDigestHex,
        }),
      ).resolves.toEqual({
        status: "NOT_ADMITTED",
        reason: "MISSING_FORECAST_CONTRACT_BINDING",
      });
    });

    it("roundtrips and converges independent duplicate writers", async () => {
      const template = record();
      const writes = await Promise.all(
        Array.from({ length: 4 }, () =>
          persistForecastContractBindingV1(sql, { ...template, id: randomUUID() }),
        ),
      );
      expect(writes.filter((result) => result.insertedNew)).toHaveLength(1);
      expect(new Set(writes.map((result) => result.id)).size).toBe(1);
      await expect(
        readForecastContractBindingV1(sql, {
          organizationId: orgA,
          selectedPredictivePackageContentDigestHex: packageDigest,
        }),
      ).resolves.toEqual(template.binding);
      await expect(
        assessForecastContractAdmissionV1(sql, {
          organizationId: orgA,
          selectedPredictivePackageContentDigestHex: packageDigest,
          inputContractDigestHex: template.binding.inputContract.contentDigestHex,
          modelSpecDigestHex: template.binding.modelSpec.contentDigestHex,
          modelArtifactDigestHex: template.binding.modelArtifact.contentDigestHex,
        }),
      ).resolves.toMatchObject({ status: "ADMITTED" });
    });

    it("fails closed for contract substitution, conflict, and cross-tenant replay", async () => {
      const first = record();
      await persistForecastContractBindingV1(sql, first);
      const stale = await assessForecastContractAdmissionV1(sql, {
        organizationId: orgA,
        selectedPredictivePackageContentDigestHex: packageDigest,
        inputContractDigestHex: first.binding.inputContract.contentDigestHex,
        modelSpecDigestHex: first.binding.modelSpec.contentDigestHex,
        modelArtifactDigestHex: hex64("stale-artifact"),
      });
      expect(stale).toEqual({
        status: "NOT_ADMITTED",
        reason: "FORECAST_CONTRACT_BINDING_MISMATCH",
      });
      await expect(persistForecastContractBindingV1(sql, record(orgA, "conflict"))).rejects.toBeInstanceOf(
        ForecastContractBindingConflictError,
      );
      await expect(persistForecastContractBindingV1(sql, record(orgB))).rejects.toThrow(
        "FORECAST_CONTRACT_BINDING_SCIENTIFIC_ADMISSION_MISMATCH",
      );
      await expect(
        readForecastContractBindingV1(sql, {
          organizationId: orgB,
          selectedPredictivePackageContentDigestHex: packageDigest,
        }),
      ).resolves.toBeNull();
    });

    it("blocks UPDATE and DELETE at the database boundary", async () => {
      const stored = record();
      await persistForecastContractBindingV1(sql, stored);
      await expect(
        sql`UPDATE trader_forecast_contract_binding_v1 SET model_artifact_digest = ${hex64("mutated")} WHERE id = ${stored.id}::uuid`,
      ).rejects.toThrow(/append-only/);
      await expect(
        sql`DELETE FROM trader_forecast_contract_binding_v1 WHERE id = ${stored.id}::uuid`,
      ).rejects.toThrow(/append-only/);
    });
  },
);
