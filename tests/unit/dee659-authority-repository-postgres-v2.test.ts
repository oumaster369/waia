import { describe, expect, it, vi } from "vitest";

import {
  createPostgresDee659AuthorityRepositoryV2,
  DEE659_DURABLE_AUTHORITY_BUNDLE_V2,
} from "@/lib/trader/historical-simulation-v2/dee659-authority-repository-postgres-v2";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { SCIENTIFIC_ADMISSION_RECEIPT_VERSION } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v1";
import {
  DEE659_TEST_DIGEST_A,
  DEE659_TEST_DIGEST_B,
  DEE659_TEST_DIGEST_C,
  DEE659_TEST_DIGEST_D,
  dee659TestAnchor,
  dee659TestAuthorityVerification,
  dee659TestCash,
  dee659TestPolicy,
  dee659TestSize,
} from "./helpers/dee659-execution-payoff-fixtures";

const ORG = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000003";

function bundle() {
  const anchorAuthority = dee659TestAnchor();
  const executablePolicy = dee659TestPolicy();
  const economicSizeSet = dee659TestSize();
  const cashAuthority = dee659TestCash();
  return {
    organizationId: ORG,
    accountId: ACCOUNT,
    cycleId: "cycle-1",
    runId: "run-1",
    datasetSealDigestHex: DEE659_TEST_DIGEST_D,
    dee659PreregistrationId: "00000000-0000-4000-8000-000000000777",
    forecastAuthorityContentDigestHex: DEE659_TEST_DIGEST_A,
    pitAnchor: new Date(anchorAuthority.forecastAnchorClosedBarEpochMs).toISOString(),
    forecastId: "forecast-1",
    forecastIssuanceReceiptDigestHex: DEE659_TEST_DIGEST_A,
    forecastVerificationReceiptDigestHex: DEE659_TEST_DIGEST_A,
    scientificAdmission: {
      id: "00000000-0000-4000-8000-000000000659",
      organizationId: ORG,
      receiptKind: "WF_PREDICTIVE",
      kmGlobalAnchorSetDigest: DEE659_TEST_DIGEST_A,
      replicaRootFamilyIdentityDigest: DEE659_TEST_DIGEST_B,
      selectedKConfigDec: 1,
      selectedMConfigDec: 1,
      alphaEpiConfigScale8: "0.1",
      selectedPackageGenerationIdentityDigest: DEE659_TEST_DIGEST_B,
      selectedPackageContentDigest: DEE659_TEST_DIGEST_C,
      evidenceSemanticDigest: DEE659_TEST_DIGEST_D,
      receiptJson: "{}",
      contentDigest: DEE659_TEST_DIGEST_A,
      schemaVersion: SCIENTIFIC_ADMISSION_RECEIPT_VERSION,
      htxVolumeQualificationReceiptDigest: DEE659_TEST_DIGEST_D,
    },
    scientificVerificationReceiptDigestHex: DEE659_TEST_DIGEST_A,
    anchorAuthority,
    executablePolicy,
    economicSizeSet,
    cashAuthority,
    executionPayoffVerification: dee659TestAuthorityVerification({
      anchor: anchorAuthority,
      policy: executablePolicy,
      size: economicSizeSet,
      cash: cashAuthority,
    }),
  };
}

function verificationReceipts(value: ReturnType<typeof bundle>) {
  return {
    loadForecastVerification: async () => ({
      verificationReceiptDigestHex: value.forecastVerificationReceiptDigestHex,
    }),
    loadScientificVerification: async () => ({
      verificationReceiptDigestHex: value.scientificVerificationReceiptDigestHex,
    }),
    loadExecutionPayoffVerification: async () => value.executionPayoffVerification,
  };
}

describe("DEE659 durable Postgres authority repository V2", () => {
  it("persists only a fully verified PIT-bound authority bundle", async () => {
    const value = bundle();
    const expectedDigest = computeStableJsonDigest({
      schemaVersion: DEE659_DURABLE_AUTHORITY_BUNDLE_V2,
      ...value,
    });
    const sql = Object.assign(
      vi.fn(async (strings: TemplateStringsArray) => {
        const query = strings.join(" ");
        if (query.includes("FROM trader_forecast_v2")) return [{
          cycle_id: value.cycleId,
          anchor_closed_bar_epoch_ms: Date.parse(value.pitAnchor),
          bundle_content_digest_hex: value.forecastIssuanceReceiptDigestHex,
          authorized_outcome_json: {
            status: "FORECAST_AUTHORIZED",
            authority: { contentDigestHex: value.forecastAuthorityContentDigestHex },
          },
          target_role_id: "EXECUTION_OPPORTUNITY",
        }];
        return [{ bundle_content_digest_hex: expectedDigest }];
      }),
      { json: (value: unknown) => value },
    );
    const repository = createPostgresDee659AuthorityRepositoryV2({
      sql: sql as never,
      verificationReceipts: verificationReceipts(value),
    });
    await repository.persist(value);
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("rejects a synthetic/unbound verification receipt before touching Postgres", async () => {
    const sql = vi.fn();
    const value = bundle();
    await expect(createPostgresDee659AuthorityRepositoryV2({
      sql: sql as never,
      verificationReceipts: verificationReceipts(value),
    }).persist({
      ...value,
      executionPayoffVerification: {
        ...value.executionPayoffVerification,
        cash: {
          ...value.executionPayoffVerification.cash,
          verificationReceiptDigestHex: "not-a-durable-receipt",
        },
      },
    })).rejects.toThrow("DEE659_DURABLE_AUTHORITY_INVALID");
    expect(sql).not.toHaveBeenCalled();
  });

  it("rejects a row whose PIT anchor differs from the forecast anchor", async () => {
    const sql = vi.fn();
    const value = bundle();
    await expect(createPostgresDee659AuthorityRepositoryV2({
      sql: sql as never,
      verificationReceipts: verificationReceipts(value),
    }).persist({
      ...value,
      pitAnchor: new Date(Date.parse(value.pitAnchor) + 60_000).toISOString(),
    })).rejects.toThrow("scopeOrPitBinding");
    expect(sql).not.toHaveBeenCalled();
  });

  it("rejects a persisted bundle whose envelope digest was corrupted", async () => {
    const value = bundle();
    const authorityRow = {
      organization_id: value.organizationId,
      account_id: value.accountId,
      cycle_id: value.cycleId,
      run_id: value.runId,
      dataset_seal_digest_hex: value.datasetSealDigestHex,
      dee659_preregistration_id: value.dee659PreregistrationId,
      forecast_authority_content_digest_hex: value.forecastAuthorityContentDigestHex,
      forecast_id: value.forecastId,
      forecast_issuance_receipt_digest_hex: value.forecastIssuanceReceiptDigestHex,
      forecast_verification_receipt_digest_hex: value.forecastVerificationReceiptDigestHex,
      scientific_admission_evidence_digest_hex: value.scientificAdmission.evidenceSemanticDigest,
      scientific_verification_receipt_digest_hex: value.scientificVerificationReceiptDigestHex,
      anchor_authority_json: value.anchorAuthority,
      executable_policy_json: value.executablePolicy,
      economic_size_set_json: value.economicSizeSet,
      cash_authority_json: value.cashAuthority,
      execution_payoff_verification_json: value.executionPayoffVerification,
      pit_anchor: value.pitAnchor,
      bundle_content_digest_hex: DEE659_TEST_DIGEST_D,
    };
    let call = 0;
    const sql = vi.fn(async () => {
      call += 1;
      if (call === 1) return [authorityRow];
      return [{
        id: value.scientificAdmission.id,
        organization_id: value.scientificAdmission.organizationId,
        receipt_kind: value.scientificAdmission.receiptKind,
        km_global_anchor_set_digest: value.scientificAdmission.kmGlobalAnchorSetDigest,
        replica_root_family_identity_digest: value.scientificAdmission.replicaRootFamilyIdentityDigest,
        selected_k_config_dec: value.scientificAdmission.selectedKConfigDec,
        selected_m_config_dec: value.scientificAdmission.selectedMConfigDec,
        alpha_epi_config_scale8: value.scientificAdmission.alphaEpiConfigScale8,
        selected_package_generation_identity_digest: value.scientificAdmission.selectedPackageGenerationIdentityDigest,
        selected_package_content_digest: value.scientificAdmission.selectedPackageContentDigest,
        evidence_semantic_digest: value.scientificAdmission.evidenceSemanticDigest,
        receipt_json: value.scientificAdmission.receiptJson,
        content_digest: value.scientificAdmission.contentDigest,
        schema_version: value.scientificAdmission.schemaVersion,
      }];
    });
    await expect(createPostgresDee659AuthorityRepositoryV2({
      sql: sql as never,
      verificationReceipts: verificationReceipts(value),
    }).load({
      organizationId: value.organizationId,
      accountId: value.accountId,
      cycleId: value.cycleId,
      forecastAuthorityContentDigestHex: value.forecastAuthorityContentDigestHex,
    })).rejects.toThrow("DEE659_DURABLE_AUTHORITY_CORRUPTION:bundleDigest");
  });
});
