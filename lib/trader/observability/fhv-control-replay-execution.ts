import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { assertFhvOfficialV2DatasetArtifactsPresent } from "@/lib/trader/market-data/fhv-official-v2-required";
import type { FhvConfigurationFreezeV1 } from "@/lib/trader/observability/fhv-configuration-freeze";
import {
  loadOfficialSharedPortfolioBars,
  type FhvDatasetQualificationReceiptV1,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import { consumeFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  prepareFhvOfficialLaunchExecution,
  recoverFhvExecutionWalForResume,
} from "@/lib/trader/observability/fhv-execution-checkpoint";
import { FHV_EXECUTION_PURPOSE_CONTROL_REPLAY } from "@/lib/trader/observability/fhv-execution-purpose";
import {
  takeoverFhvAuthorizationRunning,
  resolveFhvAuthorizationClaimPath,
} from "@/lib/trader/observability/fhv-authorization-claim";
import {
  CONTROL_REPLAY_SCIENTIFIC_V2_DRIVER_VERSION,
  runScientificControlReplayV2Ceremony,
  type ScientificControlReplayV2Result,
} from "@/lib/trader/observability/control-replay-scientific-v2-driver-v1";
import {
  assertCheckoutIdentity,
  FhvFullHistoricalLaunchError,
  readFhvFullLaunchReceipt,
  resolveFhvFullLaunchRunDirectory,
  validateFhvFullHistoricalLaunchInput,
  writeFhvFullLaunchReceipt,
  type FhvFullHistoricalLaunchInput,
  type FhvFullHistoricalLaunchResult,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { CONTROL_REPLAY_AUTHORITY_IDENTITY } from "@/lib/trader/observability/control-replay-test-authority";

export const FHV_CONTROL_REPLAY_EXECUTION_PURPOSE = "CONTROL_REPLAY" as const;

export type FhvControlReplayLaunchInput = FhvFullHistoricalLaunchInput & {
  executionPurpose: typeof FHV_CONTROL_REPLAY_EXECUTION_PURPOSE;
};

/**
 * Authoritative Control Replay economic path (DEE-518 Closure V):
 * Forecast V2 → Decision V2 → desired-size → Portfolio → Risk → Execution
 * under CONTROL_REPLAY_TEST_ONLY_AUTHORITY_V1.
 *
 * Does NOT invoke runFullHistoricalBacktest / StrategySignal V1 paper path.
 */
async function runFhvControlReplayLaunchBacktest(input: {
  launchInput: FhvControlReplayLaunchInput;
  runDir: string;
  configurationFreeze: FhvConfigurationFreezeV1;
  qualificationReceipt: FhvDatasetQualificationReceiptV1;
  qualificationReceiptDigest: string;
  launchExecution: ReturnType<typeof prepareFhvOfficialLaunchExecution>;
  launchReceiptDigest: string;
  replaceLaunchResult?: boolean;
}): Promise<FhvFullHistoricalLaunchResult> {
  // Preserve launch-shell dataset presence gates (no holdout; no FULL_HISTORICAL economics).
  if (input.launchInput.boundedFixture) {
    // bounded fixture: launch shell only — economic authority is scientific V2 below
  } else if (input.qualificationReceipt.qualificationMode === "OFFICIAL_MULTI_YEAR") {
    assertFhvOfficialV2DatasetArtifactsPresent({
      datasetRoot: input.launchInput.datasetRoot!,
      qualificationMode: input.qualificationReceipt.qualificationMode,
    });
  } else if (input.qualificationReceipt.qualificationMode === "SCHEMA_INTEGRATION_FIXTURE") {
    // Touch official shared bars only to prove dataset root is readable — not as V1 economic input.
    void loadOfficialSharedPortfolioBars({
      datasetRoot: input.launchInput.datasetRoot!,
      includeHoldout: false,
    });
  } else {
    throw new FhvFullHistoricalLaunchError(
      "UNSUPPORTED_QUALIFICATION_MODE",
      `Unsupported qualification mode for control replay bar source: ${input.qualificationReceipt.qualificationMode}`,
    );
  }

  void input.launchExecution;

  const scientific = await runScientificControlReplayV2Ceremony({
    organizationId: input.launchInput.organizationId,
  });

  const scientificEvidencePath = join(input.runDir, "control-replay-scientific-v2-result.v1.json");
  const scientificJson = `${JSON.stringify(
    {
      schemaVersion: "control-replay-scientific-v2-result/v1",
      driverVersion: CONTROL_REPLAY_SCIENTIFIC_V2_DRIVER_VERSION,
      authority: CONTROL_REPLAY_AUTHORITY_IDENTITY,
      scientific,
    },
    null,
    2,
  )}\n`;
  if (existsSync(scientificEvidencePath)) {
    writeFileAtomicCompareAndReplace({
      finalPath: scientificEvidencePath,
      expectedContent: readFileSync(scientificEvidencePath, "utf8"),
      nextContent: scientificJson,
    });
  } else {
    writeFileAtomicExclusive(scientificEvidencePath, scientificJson);
  }

  const semanticReproDigest = scientific.parityDigest;

  const classification = input.launchInput.boundedFixture
    ? ("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS" as const)
    : ("FHV_CONTROL_REPLAY_CEREMONY_PASS" as const);

  const launchResult = buildControlReplayLaunchResult({
    classification,
    semanticReproDigest,
    scientific,
    qualificationReceiptDigest: input.qualificationReceiptDigest,
    configurationFreeze: input.configurationFreeze,
    authorizationReceiptDigest: input.launchInput.authorizationReceiptDigest,
    launchReceiptDigest: input.launchReceiptDigest,
    runDir: input.runDir,
  });

  const launchResultPath = join(input.runDir, "fhv-full-launch-result.v1.json");
  const launchResultJson = `${JSON.stringify(launchResult, null, 2)}\n`;
  if (input.replaceLaunchResult && existsSync(launchResultPath)) {
    writeFileAtomicCompareAndReplace({
      finalPath: launchResultPath,
      expectedContent: readFileSync(launchResultPath, "utf8"),
      nextContent: launchResultJson,
    });
  } else {
    writeFileAtomicExclusive(launchResultPath, launchResultJson);
  }

  return {
    classification,
    receiptPath: join(input.runDir, "fhv-full-launch-receipt.v1.json"),
    runDir: input.runDir,
    semanticReproDigest,
  };
}

export async function executeFhvControlReplayLaunch(
  input: FhvControlReplayLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  if (input.executionPurpose !== FHV_CONTROL_REPLAY_EXECUTION_PURPOSE) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_PURPOSE_REQUIRED",
      "executeFhvControlReplayLaunch requires executionPurpose CONTROL_REPLAY.",
    );
  }

  const runDir = input.runDir ?? resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  assertCheckoutIdentity(input, runDir);

  const { configurationFreeze, qualificationReceipt, qualificationReceiptDigest } =
    validateFhvFullHistoricalLaunchInput({
      ...input,
      controlReplayReceiptPath: undefined,
      holdoutAccessRequested: false,
      executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
    });

  if (!input.boundedFixture && input.datasetRoot && input.manifestPath) {
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      datasetRoot: input.datasetRoot,
      manifestPath: input.manifestPath,
    });
  }

  const { receiptPath, receipt } = writeFhvFullLaunchReceipt({
    configurationFreeze,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    datasetQualificationReceiptDigest: qualificationReceiptDigest,
    artifactRoot: input.artifactRoot,
    runId: input.runId,
    boundedFixture: input.boundedFixture,
  });

  consumeFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

  const launchExecution = prepareFhvOfficialLaunchExecution({
    runDir,
    runId: input.runId,
    executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    releaseSha: input.releaseSha,
    datasetContentDigest: configurationFreeze.datasetDigest,
    manifestSemanticDigest: configurationFreeze.manifestDigest,
    configurationFreeze,
    leaseOwner: `${input.operatorId}@${input.organizationId}`,
  });

  const result = await runFhvControlReplayLaunchBacktest({
    launchInput: input,
    runDir,
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    launchExecution,
    launchReceiptDigest: receipt.launchReceiptDigest,
  });

  return { ...result, receiptPath };
}

export async function resumeFhvControlReplayLaunch(
  input: FhvControlReplayLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  if (input.executionPurpose !== FHV_CONTROL_REPLAY_EXECUTION_PURPOSE) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_PURPOSE_REQUIRED",
      "resumeFhvControlReplayLaunch requires executionPurpose CONTROL_REPLAY.",
    );
  }

  const runDir = input.runDir ?? resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  const receiptPath = join(runDir, "fhv-full-launch-receipt.v1.json");
  if (!existsSync(receiptPath)) {
    throw new FhvFullHistoricalLaunchError(
      "LAUNCH_RECEIPT_MISSING",
      "Resume requires an existing launch receipt.",
    );
  }
  const existingReceipt = readFhvFullLaunchReceipt(receiptPath);
  const receiptBeforeMtime = readFileSync(receiptPath).toString();

  assertCheckoutIdentity(input, runDir);

  const authBefore = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

  const { configurationFreeze, qualificationReceipt, qualificationReceiptDigest } =
    validateFhvFullHistoricalLaunchInput(
      {
        ...input,
        controlReplayReceiptPath: undefined,
        holdoutAccessRequested: false,
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
      },
      { resume: true },
    );

  if (!input.boundedFixture && input.datasetRoot && input.manifestPath) {
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      datasetRoot: input.datasetRoot,
      manifestPath: input.manifestPath,
    });
  }

  recoverFhvExecutionWalForResume(runDir);

  const claimPath = resolveFhvAuthorizationClaimPath(runDir);
  if (!existsSync(claimPath)) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_CLAIM_MISSING",
      "Resume requires an existing authorization claim.",
    );
  }

  takeoverFhvAuthorizationRunning({
    claimPath,
    leaseOwner: `${input.operatorId}@${input.organizationId}`,
  });

  const launchExecution = prepareFhvOfficialLaunchExecution({
    runDir,
    runId: input.runId,
    executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    releaseSha: input.releaseSha,
    datasetContentDigest: configurationFreeze.datasetDigest,
    manifestSemanticDigest: configurationFreeze.manifestDigest,
    configurationFreeze,
    leaseOwner: `${input.operatorId}@${input.organizationId}`,
  });

  const receiptAfterMtime = readFileSync(receiptPath).toString();
  if (receiptAfterMtime !== receiptBeforeMtime) {
    throw new FhvFullHistoricalLaunchError(
      "LAUNCH_RECEIPT_REWRITE_FORBIDDEN",
      "Resume must not rewrite the launch receipt.",
    );
  }

  const authAfter = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);
  if (
    authAfter.consumedAtUtc !== authBefore.consumedAtUtc ||
    authAfter.authorizationReceiptDigest !== authBefore.authorizationReceiptDigest
  ) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RECONSUME_FORBIDDEN",
      "Resume must not re-consume authorization.",
    );
  }

  return runFhvControlReplayLaunchBacktest({
    launchInput: input,
    runDir,
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    launchExecution,
    launchReceiptDigest: existingReceipt.launchReceiptDigest,
    replaceLaunchResult: true,
  });
}

function buildControlReplayLaunchResult(input: {
  classification: "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS" | "FHV_CONTROL_REPLAY_CEREMONY_PASS";
  semanticReproDigest: string;
  scientific: ScientificControlReplayV2Result;
  qualificationReceiptDigest: string;
  configurationFreeze: {
    configurationFreezeDigest: string;
    datasetDigest: string;
    manifestDigest: string;
  };
  authorizationReceiptDigest: string;
  launchReceiptDigest: string;
  runDir: string;
}) {
  return {
    schemaVersion: "fhv-full-launch-result/v1",
    classification: input.classification,
    executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
    authorityClass: CONTROL_REPLAY_AUTHORITY_IDENTITY.authorityClass,
    capitalEligible: CONTROL_REPLAY_AUTHORITY_IDENTITY.capitalEligible,
    capitalAuthorityPath: input.scientific.capitalAuthorityPath,
    driverVersion: CONTROL_REPLAY_SCIENTIFIC_V2_DRIVER_VERSION,
    completedStages: input.scientific.completedStages,
    semanticReproDigest: input.semanticReproDigest,
    cycleCount: 1,
    evidenceChain: {
      qualificationReceiptDigest: input.qualificationReceiptDigest,
      configurationFreezeDigest: input.configurationFreeze.configurationFreezeDigest,
      authorizationReceiptDigest: input.authorizationReceiptDigest,
      launchReceiptDigest: input.launchReceiptDigest,
      datasetContentDigest: input.configurationFreeze.datasetDigest,
      manifestSemanticDigest: input.configurationFreeze.manifestDigest,
      accountingStateDigest: input.scientific.accountingSemanticDigest,
      scientificParityDigest: input.scientific.parityDigest,
      packageContentDigestHex: input.scientific.packageContentDigestHex,
      scientificAdmissionReceiptDigest: input.scientific.scientificAdmissionReceiptDigest,
      executablePolicyDigest: input.scientific.executablePolicyDigest,
      fullHistoryRescanCount: getFullHistoryRescanCount(),
      holdoutStatus: "SEALED_NOT_ACCESSED" as const,
      runDir: input.runDir,
    },
    accountingFrontierState: undefined,
    htrPnlReportV1: undefined,
  };
}

export function readFhvControlReplayLaunchCheckoutDigest(proofPath: string): string {
  const proof = JSON.parse(readFileSync(proofPath, "utf8")) as { contentDigest?: string };
  if (!proof.contentDigest) {
    throw new FhvFullHistoricalLaunchError(
      "CHECKOUT_PROOF_DIGEST_MISSING",
      "Checkout identity proof contentDigest missing.",
    );
  }
  return proof.contentDigest;
}

export function readFhvControlReplayLaunchAuthorizationDigest(receiptPath: string): string {
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as {
    authorizationReceiptDigest?: string;
  };
  if (!receipt.authorizationReceiptDigest) {
    throw new FhvFullHistoricalLaunchError(
      "AUTHORIZATION_RECEIPT_DIGEST_MISSING",
      "Authorization receipt digest missing.",
    );
  }
  return receipt.authorizationReceiptDigest;
}

export function readFhvControlReplayLaunchFreezeDigest(freezePath: string): string {
  const artifact = JSON.parse(readFileSync(freezePath, "utf8")) as {
    configurationFreeze?: { configurationFreezeDigest?: string };
  };
  const digest = artifact.configurationFreeze?.configurationFreezeDigest;
  if (!digest) {
    throw new FhvFullHistoricalLaunchError(
      "CONFIGURATION_FREEZE_DIGEST_MISSING",
      "Configuration freeze digest missing.",
    );
  }
  return digest;
}
