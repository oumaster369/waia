import { bindInformationSufficiencyReceiptAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import type { InformationEvidenceV2 } from "@/lib/trader/intelligence/information-sufficiency";
import {
  computeInquiryContentDigest,
  defineInformationAcquisitionSelectionV1,
  inquiryCanonicalJsonString,
  inquiryCanonicalTextCompare,
  type InformationAcquisitionSelectionV1,
} from "@/lib/trader/intelligence/information-inquiry/contracts-v1";
import {
  runInformationInquiryLoopV1,
  type InformationAcquisitionAttemptInputV1,
  type InformationInquiryLoopReceiptV1,
} from "@/lib/trader/intelligence/information-inquiry/information-inquiry-loop-v1";
import {
  buildInformationNeedPlanningBundleV1,
  type BuildInformationNeedPlanV1Input,
  type InformationInquiryPlanningBundleV1,
} from "@/lib/trader/intelligence/information-inquiry/information-need-planner-v1";
import type { InformationSufficiencyRuntimeAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import {
  INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION,
  type InformationAcquisitionReceiptV1,
} from "@/lib/trader/market-data/types";

export type InformationInquiryRuntimeAcquisitionV1 = Readonly<{
  receipt: InformationAcquisitionReceiptV1;
  finalEvidence: readonly InformationEvidenceV2[];
  attempts: readonly InformationAcquisitionAttemptInputV1[];
}>;

export type InformationInquiryRuntimeResultV1 = Readonly<{
  planningBundle: InformationInquiryPlanningBundleV1;
  selection: InformationAcquisitionSelectionV1;
  acquisitionReceipt: InformationAcquisitionReceiptV1 | null;
  loopReceipt: InformationInquiryLoopReceiptV1;
  informationSufficiencyAuthority: InformationSufficiencyRuntimeAuthorityV2;
  authority: "INFORMATION_INQUIRY_COMPOSITION_ONLY";
  createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false;
}>;

export type InformationInquiryRuntimeExpectedScopeV1 = Readonly<{
  organizationId: string;
  accountId: string;
  symbol: string;
  pitAnchor: string;
}>;

export type InformationInquiryCycleAuthorityResolverV1<TMandatory> = (mandatory: TMandatory) =>
  | Promise<Readonly<{
      planningInput: BuildInformationNeedPlanV1Input;
      acquire(
        selection: InformationAcquisitionSelectionV1,
      ): Promise<InformationInquiryRuntimeAcquisitionV1>;
    }> | null>
  | Readonly<{
      planningInput: BuildInformationNeedPlanV1Input;
      acquire(
        selection: InformationAcquisitionSelectionV1,
      ): Promise<InformationInquiryRuntimeAcquisitionV1>;
    }>
  | null;

export function assertInformationInquiryRuntimeScopeV1(
  planningInput: BuildInformationNeedPlanV1Input,
  expected: InformationInquiryRuntimeExpectedScopeV1,
): void {
  if (
    planningInput.profile.organizationId !== expected.organizationId ||
    planningInput.receipt.organizationId !== expected.organizationId ||
    planningInput.profile.accountId !== expected.accountId ||
    planningInput.receipt.accountId !== expected.accountId ||
    planningInput.profile.symbol !== expected.symbol ||
    planningInput.receipt.symbol !== expected.symbol ||
    planningInput.receipt.pitAnchor !== expected.pitAnchor
  ) {
    throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:expectedScope");
  }
}

function assertFinalEvidenceBinding(input: {
  initialEvidence: readonly InformationEvidenceV2[];
  acquisition: InformationInquiryRuntimeAcquisitionV1;
}): void {
  const initialById = new Map<string, InformationEvidenceV2>();
  for (const evidence of input.initialEvidence) {
    if (initialById.has(evidence.evidenceId)) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:duplicateInitialEvidenceId");
    }
    initialById.set(evidence.evidenceId, evidence);
  }
  const finalById = new Map<string, InformationEvidenceV2>();
  for (const evidence of input.acquisition.finalEvidence) {
    if (finalById.has(evidence.evidenceId)) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:duplicateFinalEvidenceId");
    }
    finalById.set(evidence.evidenceId, evidence);
  }
  for (const [evidenceId, initialEvidence] of initialById) {
    const finalEvidence = finalById.get(evidenceId);
    if (
      !finalEvidence ||
      inquiryCanonicalJsonString(finalEvidence) !== inquiryCanonicalJsonString(initialEvidence)
    ) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:initialEvidenceClosure");
    }
  }

  const acquiredEvidenceIds = new Set<string>();
  for (const outcome of input.acquisition.receipt.outcomes) {
    const attempt = input.acquisition.attempts.find(
      (candidate) =>
        candidate.needId === outcome.requestedSource.needId &&
        candidate.providerId === outcome.requestedSource.providerId,
    );
    if (!attempt) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:attemptAcquisitionMismatch");
    }
    const attemptDigests = attempt.evidenceIds
      .map((evidenceId) => {
        if (initialById.has(evidenceId)) {
          throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:acquiredEvidenceIdentity");
        }
        const evidence = finalById.get(evidenceId);
        if (!evidence) {
          throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:attemptEvidenceClosure");
        }
        acquiredEvidenceIds.add(evidenceId);
        return evidence.observationContentDigest;
      })
      .sort(inquiryCanonicalTextCompare);
    if (
      inquiryCanonicalJsonString(attemptDigests) !==
      inquiryCanonicalJsonString(outcome.observationContentDigests)
    ) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:attemptObservationDigestBinding");
    }
  }
  if (finalById.size !== initialById.size + acquiredEvidenceIds.size) {
    throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:finalEvidenceClosure");
  }
}

function assertAcquisitionBinding(input: {
  selection: InformationAcquisitionSelectionV1;
  acquisition: InformationInquiryRuntimeAcquisitionV1;
}): void {
  const receipt = input.acquisition.receipt;
  const outcomes = [...receipt.outcomes].sort((left, right) =>
    inquiryCanonicalTextCompare(
      `${left.requestedSource.needId}\u0000${left.requestedSource.providerId}`,
      `${right.requestedSource.needId}\u0000${right.requestedSource.providerId}`,
    ),
  );
  const expectedSources = [...input.selection.requestedSources].sort((left, right) =>
    inquiryCanonicalTextCompare(
      `${left.needId}\u0000${left.providerId}`,
      `${right.needId}\u0000${right.providerId}`,
    ),
  );
  const causalObservationContentDigests = [
    ...new Set(outcomes.flatMap((outcome) => outcome.observationContentDigests)),
  ].sort(inquiryCanonicalTextCompare);
  const digestPayload = {
    schemaVersion: receipt.schemaVersion,
    selectionContentDigest: receipt.selectionContentDigest,
    mode: receipt.mode,
    outcomes: receipt.outcomes.map((outcome) => ({
      requestedSource: outcome.requestedSource,
      status: outcome.status,
      reasonCode: outcome.reasonCode,
      canonicalPitAttempts: outcome.canonicalPitAttempts,
      observationContentDigests: outcome.observationContentDigests,
    })),
    causalObservationContentDigests: receipt.causalObservationContentDigests,
    authority: receipt.authority,
  };
  if (
    receipt.schemaVersion !== INFORMATION_ACQUISITION_RECEIPT_V1_SCHEMA_VERSION ||
    receipt.selectionContentDigest !== input.selection.contentDigest ||
    receipt.mode !== input.selection.mode ||
    receipt.authority !== "EVIDENCE_ACQUISITION_ONLY" ||
    receipt.contentDigest !== computeInquiryContentDigest(digestPayload) ||
    inquiryCanonicalJsonString(causalObservationContentDigests) !==
      inquiryCanonicalJsonString(receipt.causalObservationContentDigests) ||
    inquiryCanonicalJsonString(outcomes.map((outcome) => outcome.requestedSource)) !==
      inquiryCanonicalJsonString(expectedSources)
  ) {
    throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:acquisitionReceipt");
  }
  for (const outcome of receipt.outcomes) {
    const expectedObservationContentDigests = outcome.canonicalPitAttempts
      .filter((attempt) => attempt.status === "AVAILABLE")
      .map((attempt) => attempt.normalizedInputDigest)
      .sort(inquiryCanonicalTextCompare);
    if (
      !("AVAILABLE,UNAVAILABLE,REJECTED".split(",") as string[]).includes(outcome.status) ||
      (outcome.status === "AVAILABLE") !== (outcome.reasonCode === null) ||
      outcome.canonicalPitAttempts.some(
        (attempt) =>
          attempt.providerId !== outcome.requestedSource.providerId ||
          attempt.status !== outcome.status ||
          (attempt.kind !== null &&
            !(outcome.requestedSource.allowedObservationKinds as readonly string[]).includes(
              attempt.kind,
            )),
      ) ||
      (outcome.status === "AVAILABLE" &&
        inquiryCanonicalJsonString(expectedObservationContentDigests) !==
          inquiryCanonicalJsonString(outcome.observationContentDigests)) ||
      (outcome.status !== "AVAILABLE" && outcome.observationContentDigests.length !== 0)
    ) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:acquisitionOutcome");
    }
    const attempts = input.acquisition.attempts.filter(
      (attempt) =>
        attempt.needId === outcome.requestedSource.needId &&
        attempt.providerId === outcome.requestedSource.providerId,
    );
    if (
      attempts.length !== 1 ||
      attempts[0]!.requirementId !== outcome.requestedSource.requirementId ||
      attempts[0]!.outcome !== outcome.status
    ) {
      throw new Error("INFORMATION_INQUIRY_RUNTIME_INVALID:attemptAcquisitionMismatch");
    }
  }
}

export async function runInformationInquiryRuntimeV1(
  input: Readonly<{
    planningInput: BuildInformationNeedPlanV1Input;
    mode: "LIVE" | "HISTORICAL";
    acquire(
      selection: InformationAcquisitionSelectionV1,
    ): Promise<InformationInquiryRuntimeAcquisitionV1>;
  }>,
): Promise<InformationInquiryRuntimeResultV1> {
  const planningBundle = buildInformationNeedPlanningBundleV1(input.planningInput);
  const selection = defineInformationAcquisitionSelectionV1({
    planId: planningBundle.plan.id,
    planContentDigest: planningBundle.plan.contentDigest,
    organizationId: planningBundle.plan.organizationId,
    accountId: planningBundle.plan.accountId,
    symbol: planningBundle.plan.symbol,
    pitAnchor: planningBundle.plan.pitAnchor,
    purpose: planningBundle.plan.purpose,
    mode: input.mode,
    requestedSources: planningBundle.plan.requestedSources,
  });
  const acquisition =
    selection.requestedSources.length === 0 ? null : await input.acquire(selection);
  if (acquisition !== null) {
    assertAcquisitionBinding({ selection, acquisition });
    assertFinalEvidenceBinding({
      initialEvidence: input.planningInput.receipt.evidenceInventory,
      acquisition,
    });
  }
  const loopReceipt = runInformationInquiryLoopV1({
    bundle: planningBundle,
    planningInput: input.planningInput,
    attempts: acquisition?.attempts ?? [],
    finalEvidence: acquisition?.finalEvidence ?? input.planningInput.receipt.evidenceInventory,
    activeContextTriggers: input.planningInput.receipt.activeContextTriggers,
    aggregateQualityEvaluation: input.planningInput.receipt.aggregateQualityEvaluation,
  });
  return Object.freeze({
    planningBundle,
    selection,
    acquisitionReceipt: acquisition?.receipt ?? null,
    loopReceipt,
    informationSufficiencyAuthority: bindInformationSufficiencyReceiptAuthorityV2(
      input.planningInput.profile,
      loopReceipt.finalSufficiencyReceipt,
    ),
    authority: "INFORMATION_INQUIRY_COMPOSITION_ONLY" as const,
    createsKnowledgeHypothesisForecastDecisionOrCapitalAuthority: false as const,
  });
}
