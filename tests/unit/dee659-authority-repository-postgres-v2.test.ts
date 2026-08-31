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
    forecastAuthorityContentDigestHex: DEE659_TEST_DIGEST_A,
    pitAnchor: new Date(anchorAuthority.forecastAnchorClosedBarEpochMs).toISOString(),
    forecastId: "forecast-1",
    forecastIssuanceReceiptDigestHex: DEE659_TEST_DIGEST_A,
    forecastVerificationReceiptDigestHex: DEE659_TEST_DIGEST_B,
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
    scientificVerificationReceiptDigestHex: DEE659_TEST_DIGEST_C,
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

describe("DEE659 durable Postgres authority repository V2", () => {
  it("persists only a fully verified PIT-bound authority bundle", async () => {
    const value = bundle();
    const expectedDigest = computeStableJsonDigest({
      schemaVersion: DEE659_DURABLE_AUTHORITY_BUNDLE_V2,
      ...value,
    });
    const sql = Object.assign(
      vi.fn(async () => [{ bundle_content_digest_hex: expectedDigest }]),
      { json: (value: unknown) => value },
    );
    const repository = createPostgresDee659AuthorityRepositoryV2(sql as never);
    await repository.persist(value);
    expect(sql).toHaveBeenCalledOnce();
  });

  it("rejects a synthetic/unbound verification receipt before touching Postgres", async () => {
    const sql = vi.fn();
    const value = bundle();
    await expect(createPostgresDee659AuthorityRepositoryV2(sql as never).persist({
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
    await expect(createPostgresDee659AuthorityRepositoryV2(sql as never).persist({
      ...value,
      pitAnchor: new Date(Date.parse(value.pitAnchor) + 60_000).toISOString(),
    })).rejects.toThrow("scopeOrPitBinding");
    expect(sql).not.toHaveBeenCalled();
  });
});
