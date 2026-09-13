import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPredictiveTerminalReceiptV1, validatePredictiveTerminalReceipt, type PredictiveTerminalReceiptV1 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { computeTrialIdentityDigestV2, type TrialIdentityInput } from "@/lib/trader/research/benchmark/trial-identity-v2";
import { CDF_ERF_CODY715_VERSION, CDF_REFERENCE_AMENDMENT_DIGEST, PREDICTIVE_TERMINAL_CHECKPOINT_STAGE } from "@/lib/trader/research/benchmark/cdf-evidence-protocol-v2";
import { computeResearchHarnessAdmissionReceiptDigestV2 } from "@/lib/trader/research/benchmark/research-harness-admission-orchestrator-v1";

const hex = (x: string) => x.repeat(64);
const identities = {
  developmentDatasetDigestHex:hex("1"), targetGridReceiptDigestHex:hex("2"),
  predictivePackageGenerationIdentityDigestHex:hex("3"), predictivePackageContentDigestHex:hex("4"),
  runtimeContractDigestHex:hex("5"), scoringContractVersion:"multiclass-brier-reward/v1" as const,
  evaluationPartitionReceiptDigestHex:hex("6"),
};
const seal = (receipt: PredictiveTerminalReceiptV1): PredictiveTerminalReceiptV1 => {
  const {contentDigestHex: _old, ...body} = receipt;
  void _old;
  return {...body, contentDigestHex:createHash("sha256").update(JSON.stringify(body)).digest("hex")};
};
describe("DEE-993 current evidence cannot admit legacy/mixed Cody results", () => {
  let yes: PredictiveTerminalReceiptV1, no: PredictiveTerminalReceiptV1;
  beforeAll(() => {
    const input = {
      venue:"htx",market:"spot",symbol:"BTCUSDT",primaryHorizonMinutes:30 as const,
      challengerPackageContentDigestHex:identities.predictivePackageContentDigestHex,
      comparisonFamilyId:"synthetic-cody-binding",evaluationPartitionReceiptDigestHex:hex("6"),
      purgeDurationMinutes:30,embargoDurationMinutes:30,
      developmentReturns:Array.from({length:400},(_,i)=>(i-200)/10000),
      historyReturns:Array(2000).fill(0),
      historyReturnMinuteOpenTimesMs:Array.from({length:2000},(_,i)=>i*60000),
      anchors:[{anchorId:"synthetic",observedReturn:1,challengerProbabilities:[0,0,0,0,0,0,1]}],
    };
    yes=buildPredictiveTerminalReceiptV1({identities,harnessInput:input});
    no=buildPredictiveTerminalReceiptV1({identities,harnessInput:{...input,anchors:[]}});
    expect(yes.terminalStatus).toBe("QUALIFIED");
    expect(no.terminalStatus).toBe("NO_CHALLENGER_QUALIFIES");
  });
  it.each([true,false])("accepts both current terminal statuses; qualified=%s", qualified => {
    const receipt=qualified?yes:no;
    expect(receipt.cdfKernelVersion).toBe(CDF_ERF_CODY715_VERSION);
    expect(receipt.cdfAmendmentDigestHex).toBe(CDF_REFERENCE_AMENDMENT_DIGEST);
    expect(()=>validatePredictiveTerminalReceipt(receipt)).not.toThrow();
  });
  it.each([true,false])("rejects resealed absent/legacy/wrong protocol before verdict; qualified=%s", qualified => {
    for (const patch of [
      {cdfKernelVersion:undefined}, {cdfAmendmentDigestHex:undefined},
      {cdfKernelVersion:"cdf-erf-cody715/v1"}, {cdfAmendmentDigestHex:hex("f")},
    ]) {
      const tampered=seal({...structuredClone(qualified?yes:no),...patch} as PredictiveTerminalReceiptV1);
      expect(()=>validatePredictiveTerminalReceipt(tampered)).toThrow("SCIENTIFIC_ADMISSION_CDF_CONTRACT_MISMATCH");
    }
  });
  it.each(["mandatory","availability","means","comparisons","holm","diagnostics"])("rejects mixed legacy IDs in %s", location => {
    for (const original of [yes,no]) {
      const r=structuredClone(original), old="gaussian-pop-std/v1";
      if(location==="mandatory") r.mandatoryBaselineIds=[...r.mandatoryBaselineIds,old];
      if(location==="availability") r.baselineAvailability[old]="AVAILABLE";
      if(location==="means") r.meanImprovementByBaseline[old]=1;
      if(location==="comparisons") r.holmComparisons=[...r.holmComparisons,{comparisonId:old,pValue:0.0001}];
      if(location==="holm") r.holmResults=[...r.holmResults,{...yes.holmResults[0]!,comparisonId:old}];
      if(location==="diagnostics") r.logScoreDiagnostics[old]=yes.logScoreDiagnostics["gaussian-pop-std/v2"]!;
      expect(()=>validatePredictiveTerminalReceipt(seal(r))).toThrow();
    }
  });
  it("binds changed baseline IDs into trial digests without rewriting trial serialization", () => {
    const base: TrialIdentityInput={
      scoringContractVersion:identities.scoringContractVersion,evaluationPartitionReceiptDigestHex:hex("6"),
      venue:"htx",market:"spot",symbol:"BTCUSDT",primaryHorizonMinutes:30,modelTransformVersion:"empirical/v1",
      challengerPackageContentDigestHex:hex("4"),baselineId:"unused",metricId:"terminal-multiclass-brier-reward/v1",
      commonAnchorSetDigestHex:hex("7"),purgeDurationMinutes:30,embargoDurationMinutes:30,comparisonFamilyId:"fixture",
    };
    for(const [old,next] of [["gaussian-pop-std/v1","gaussian-pop-std/v2"],["ewma-lambda094/v2","ewma-lambda094/v3"]]) {
      expect(computeTrialIdentityDigestV2({...base,baselineId:old!}).equals(
        computeTrialIdentityDigestV2({...base,baselineId:next!}))).toBe(false);
    }
  });
  it("separates harness receipts even when numeric comparisons coincide", () => {
    const input={comparisonFamilyId:no.comparisonFamilyId,commonAnchorSetDigestHex:no.commonAnchorSetDigestHex,
      holmComparisons:no.holmComparisons,terminalStatus:no.terminalStatus};
    const legacy=createHash("sha256").update([
      "scientific-admission-receipt/v4",no.scoringContractVersion,no.scoringMetric,no.scoringAmendmentDigestHex,
      // Deliberately use the currently unchanged bootstrap version, read from source below.
      readFileSync("lib/trader/research/benchmark/validation-bootstrap-v1.ts","utf8").match(/VALIDATION_BOOTSTRAP_VERSION = "([^"]+)"/)![1],
      input.comparisonFamilyId,input.commonAnchorSetDigestHex,input.terminalStatus,
    ].join("\n")).digest("hex");
    expect(computeResearchHarnessAdmissionReceiptDigestV2(input)).not.toBe(legacy);
  });
  it("versions only Terminal cache and validates it before interpreting the verdict", () => {
    expect(PREDICTIVE_TERMINAL_CHECKPOINT_STAGE).toBe("wf-predictive-terminal-v3");
    const source=readFileSync("lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts","utf8");
    expect(source).toContain("reuseScientificEvidenceAsyncV1(PREDICTIVE_TERMINAL_CHECKPOINT_STAGE,");
    expect(source).toContain("cdfAmendmentDigestHex: CDF_REFERENCE_AMENDMENT_DIGEST");
    expect(source.indexOf("validatePredictiveTerminalReceipt(predictive)")).toBeLessThan(
      source.indexOf('if (predictive.terminalStatus !== "QUALIFIED")'));
    expect(source).toContain('"wf-forecast-batch-v1"');
  });
});
