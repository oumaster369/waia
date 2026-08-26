import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { MANDATORY_BASELINE_IDS } from "@/lib/trader/research/benchmark/baseline-models-v1";
import { qualifyHtxKlineVolumeAuthority } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import {
  type ResearchHarnessAdmissionInputV1,
} from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";
import {
  bucketIndexForReturn,
  computeTerminalTargetGridFromDevelopmentReturns,
} from "@/lib/trader/research/benchmark/target-grid-ceremony-v1";
import { buildKmConvergenceReceiptV1 } from "@/lib/trader/research/execopp-qualification/km-convergence-gate-v1";
import {
  buildEpistemicParameterRatificationReceiptV1,
  buildPredictiveTerminalReceiptV1,
  buildScientificAdmissionReceiptV2,
  requireScientificAdmissionV2,
} from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { buildScientificAdmissionReceiptRecordV2 } from "@/lib/trader/research/execopp-qualification/scientific-admission-receipt-service-v2";

const hex = (char: string) => char.repeat(64);

const identities = {
  developmentDatasetDigestHex: hex("1"),
  targetGridReceiptDigestHex: hex("2"),
  predictivePackageGenerationIdentityDigestHex: hex("3"),
  predictivePackageContentDigestHex: hex("4"),
  runtimeContractDigestHex: hex("5"),
  scoringContractVersion: "multiclass-log-score/v1" as const,
  evaluationPartitionReceiptDigestHex: hex("6"),
};

function harnessInput(qualified = true): ResearchHarnessAdmissionInputV1 {
  const developmentReturns = Array.from(
    { length: 400 },
    (_, index) => Math.sin(index / 17) * 0.02 + (index % 9) * 0.0005,
  );
  const historyReturns = Array.from(
    { length: 2500 },
    (_, index) => developmentReturns[index % developmentReturns.length]!,
  );
  const grid = computeTerminalTargetGridFromDevelopmentReturns(developmentReturns);
  const observed = qualified ? developmentReturns.slice(0, 24) : [];
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    primaryHorizonMinutes: 30,
    challengerPackageContentDigestHex: identities.predictivePackageContentDigestHex,
    comparisonFamilyId: "family-v2",
    evaluationPartitionReceiptDigestHex: identities.evaluationPartitionReceiptDigestHex,
    purgeDurationMinutes: 30,
    embargoDurationMinutes: 30,
    developmentReturns,
    historyReturns,
    historyReturnMinuteOpenTimesMs: historyReturns.map((_, index) => 1_700_000_000_000 + index * 60_000),
    anchors: observed.map((observedReturn, index) => {
      const bucket = bucketIndexForReturn(observedReturn, grid);
      return {
        anchorId: `anchor-${index}`,
        observedReturn,
        challengerProbabilities: Array.from({ length: 7 }, (_, bucketIndex) =>
          bucketIndex === bucket ? 0.999 : 0.001 / 6,
        ),
      };
    }),
  };
}

function kmReceipt(qualifies = true) {
  return buildKmConvergenceReceiptV1({
    replicaRootFamilyIdentityDigestHex: hex("8"),
    kmGlobalAnchorSetDigestHex: hex("9"),
    candidateGenerationDigestsHex: [hex("a")],
    configurations: [
      {
        kConfig: 10,
        mConfig: 20,
        evLowerRelativeErrorP95: 0.001,
        evBaseRelativeErrorP95: 0.001,
        evUpperRelativeErrorP95: 0.001,
        mcEsRelativeErrorP95: 0.001,
        qualifies,
      },
    ],
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
  });
}

function admittedFixture() {
  const predictive = buildPredictiveTerminalReceiptV1({ harnessInput: harnessInput(), identities });
  const km = kmReceipt();
  const ratification = buildEpistemicParameterRatificationReceiptV1({
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    selectedK: km.selectedK!,
    selectedM: km.selectedM!,
    alphaEpiConfigScale8: km.alphaEpiConfigScale8,
    selectedPackageGenerationIdentityDigestHex: identities.predictivePackageGenerationIdentityDigestHex,
    selectedPackageContentDigestHex: identities.predictivePackageContentDigestHex,
    humanReceiptIdentityDigestHex: hex("b"),
  });
  const receipt = buildScientificAdmissionReceiptV2({
    organizationId: "org-a",
    predictiveTerminalReceipt: predictive,
    kmConvergenceReceipt: km,
    epistemicParameterRatificationReceipt: ratification,
  });
  const expected = {
    organizationId: "org-a",
    ...identities,
    kmConvergenceEvidenceSemanticDigestHex: km.evidenceSemanticDigestHex,
    epistemicParameterRatificationReceiptDigestHex: ratification.contentDigestHex,
    predictiveTerminalReceiptContentDigestHex: predictive.contentDigestHex,
  };
  return { receipt, expected, predictive, km, ratification };
}

describe("DEE-631 scientific admission receipt v2", () => {
  it("conjunctively admits exact predictive, KM and Human-ratified identities deterministically", () => {
    const first = admittedFixture();
    const second = admittedFixture();
    expect(first.receipt).toEqual(second.receipt);
    expect(first.receipt.terminalStatus).toBe("ADMITTED");
    expect(requireScientificAdmissionV2(first.receipt, first.expected)).toEqual(first.receipt);
  });

  it("builds a deterministic durable v2 record payload behind qualified volume authority", () => {
    const fixture = admittedFixture();
    const volume = qualifyHtxKlineVolumeAuthority({
      symbol: "BTCUSDT",
      rows: [
        { id: 1, open: 100, high: 101, low: 99, close: 100, amount: 10, vol: 1000, count: 1 },
        { id: 2, open: 50, high: 51, low: 49, close: 50, amount: 10, vol: 500, count: 1 },
      ],
    });
    const record = buildScientificAdmissionReceiptRecordV2({
      organizationId: "org-a",
      predictiveTerminalReceipt: fixture.predictive,
      kmConvergenceReceipt: fixture.km,
      epistemicParameterRatificationReceipt: fixture.ratification,
      htxVolumeQualificationReceipt: volume,
    });
    expect(record.schemaVersion).toBe("scientific-admission-receipt/v2");
    expect(JSON.parse(record.receiptJson)).toEqual(fixture.receipt);
    expect(record.evidenceSemanticDigest).toBe(fixture.receipt.evidenceSemanticDigestHex);
  });

  it("derives canonical no-challenger from authoritative harness input", () => {
    const predictive = buildPredictiveTerminalReceiptV1({
      harnessInput: harnessInput(false),
      identities,
    });
    expect(predictive.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
    expect(predictive.reasonCodes).toContain("COMMON_ANCHOR_SET_EMPTY");
  });

  it("rejects package or partition substitution across harness identities", () => {
    expect(() =>
      buildPredictiveTerminalReceiptV1({
        harnessInput: { ...harnessInput(), challengerPackageContentDigestHex: hex("e") },
        identities,
      }),
    ).toThrow("PREDICTIVE_TERMINAL_HARNESS_IDENTITY_MISMATCH");
    expect(() =>
      buildPredictiveTerminalReceiptV1({
        harnessInput: { ...harnessInput(), evaluationPartitionReceiptDigestHex: hex("e") },
        identities,
      }),
    ).toThrow("PREDICTIVE_TERMINAL_HARNESS_IDENTITY_MISMATCH");
  });

  it("fails closed on KM failure or KM/Human ratification mismatch", () => {
    const fixture = admittedFixture();
    expect(() =>
      buildScientificAdmissionReceiptV2({
        organizationId: "org-a",
        predictiveTerminalReceipt: fixture.predictive,
        kmConvergenceReceipt: kmReceipt(false),
        epistemicParameterRatificationReceipt: fixture.ratification,
      }),
    ).toThrow("SCIENTIFIC_ADMISSION_KM_RATIFICATION_MISMATCH");

    const wrongRatification = buildEpistemicParameterRatificationReceiptV1({
      ...fixture.ratification,
      selectedK: 20,
      humanReceiptIdentityDigestHex: hex("c"),
    });
    expect(() =>
      buildScientificAdmissionReceiptV2({
        organizationId: "org-a",
        predictiveTerminalReceipt: fixture.predictive,
        kmConvergenceReceipt: fixture.km,
        epistemicParameterRatificationReceipt: wrongRatification,
      }),
    ).toThrow("SCIENTIFIC_ADMISSION_KM_RATIFICATION_MISMATCH");
  });

  it("rejects a self-digested non-ratified Human receipt", () => {
    const fixture = admittedFixture();
    const { contentDigestHex: _digest, ...body } = fixture.ratification;
    expect(_digest).toMatch(/^[0-9a-f]{64}$/);
    const forgedBody = { ...body, verdict: "REJECTED" as const };
    const forged = {
      ...forgedBody,
      contentDigestHex: createHash("sha256").update(JSON.stringify(forgedBody), "utf8").digest("hex"),
    };
    expect(() =>
      buildScientificAdmissionReceiptV2({
        organizationId: "org-a",
        predictiveTerminalReceipt: fixture.predictive,
        kmConvergenceReceipt: fixture.km,
        epistemicParameterRatificationReceipt: forged as unknown as typeof fixture.ratification,
      }),
    ).toThrow("SCIENTIFIC_ADMISSION_RATIFICATION_NOT_RATIFIED");
  });

  it("preserves canonical no-challenger as terminal-valid but NOT_ADMITTED", () => {
    const predictive = buildPredictiveTerminalReceiptV1({ harnessInput: harnessInput(false), identities });
    const { km, ratification } = admittedFixture();
    const receipt = buildScientificAdmissionReceiptV2({
      organizationId: "org-a",
      predictiveTerminalReceipt: predictive,
      kmConvergenceReceipt: km,
      epistemicParameterRatificationReceipt: ratification,
    });
    expect(receipt.terminalStatus).toBe("NOT_ADMITTED");
  });

  it("rejects digest tampering, stale identities and cross-org replay", () => {
    const fixture = admittedFixture();
    expect(() =>
      requireScientificAdmissionV2(
        { ...fixture.receipt, contentDigestHex: hex("f") },
        fixture.expected,
      ),
    ).toThrow("SCIENTIFIC_ADMISSION_V2_CONTENT_MISMATCH");
    expect(() =>
      requireScientificAdmissionV2(fixture.receipt, {
        ...fixture.expected,
        runtimeContractDigestHex: hex("d"),
      }),
    ).toThrow("SCIENTIFIC_ADMISSION_V2_STALE_OR_REPLAYED_BINDING");
    expect(() =>
      requireScientificAdmissionV2(fixture.receipt, {
        ...fixture.expected,
        organizationId: "org-b",
      }),
    ).toThrow("SCIENTIFIC_ADMISSION_V2_STALE_OR_REPLAYED_BINDING");
  });

  it("rejects a self-digested forged predictive PASS", () => {
    const fixture = admittedFixture();
    const { contentDigestHex, ...body } = fixture.predictive;
    expect(contentDigestHex).toMatch(/^[0-9a-f]{64}$/);
    const forgedBody = {
      ...body,
      meanImprovementByBaseline: {
        ...body.meanImprovementByBaseline,
        [MANDATORY_BASELINE_IDS[0]]: -0.01,
      },
    };
    const forged = {
      ...forgedBody,
      contentDigestHex: createHash("sha256")
        .update(JSON.stringify(forgedBody), "utf8")
        .digest("hex"),
    };
    expect(() =>
      buildScientificAdmissionReceiptV2({
        organizationId: "org-a",
        predictiveTerminalReceipt: forged,
        kmConvergenceReceipt: fixture.km,
        epistemicParameterRatificationReceipt: fixture.ratification,
      }),
    ).toThrow("SCIENTIFIC_ADMISSION_PREDICTIVE_POSITIVE_MEAN_MISMATCH");
  });
});
