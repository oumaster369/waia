import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { loadApprovedBenchmarkFixture } from "@/lib/trader/backtest/replay-benchmark-harness";
import type { RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import type { Bar } from "@/lib/trader/intelligence/types";
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
import { resolveFhvGenerationSessionDbPath } from "@/lib/trader/observability/fhv-generation-session-path";
import { runFullHistoricalBacktest } from "@/lib/trader/observability/fhv-full-historical-engine";
import {
  assertCheckoutIdentity,
  FhvFullHistoricalLaunchError,
  readFhvFullLaunchReceipt,
  resolveFhvFullLaunchRunDirectory,
  stripRunIdentityForControlReplay,
  validateFhvFullHistoricalLaunchInput,
  writeFhvFullLaunchReceipt,
  type FhvFullHistoricalLaunchInput,
  type FhvFullHistoricalLaunchResult,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";

export const FHV_CONTROL_REPLAY_EXECUTION_PURPOSE = "CONTROL_REPLAY" as const;

export type FhvControlReplayLaunchInput = FhvFullHistoricalLaunchInput & {
  executionPurpose: typeof FHV_CONTROL_REPLAY_EXECUTION_PURPOSE;
};

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
  let bars: readonly Bar[] | undefined;
  let datasetRoot: string | undefined;
  const includeHoldout = false;

  if (input.launchInput.boundedFixture) {
    bars = loadApprovedBenchmarkFixture().bars;
  } else if (input.qualificationReceipt.qualificationMode === "OFFICIAL_MULTI_YEAR") {
    assertFhvOfficialV2DatasetArtifactsPresent({
      datasetRoot: input.launchInput.datasetRoot!,
      qualificationMode: input.qualificationReceipt.qualificationMode,
    });
    datasetRoot = input.launchInput.datasetRoot!;
  } else if (input.qualificationReceipt.qualificationMode === "SCHEMA_INTEGRATION_FIXTURE") {
    bars = loadOfficialSharedPortfolioBars({
      datasetRoot: input.launchInput.datasetRoot!,
      includeHoldout,
    });
  } else {
    throw new FhvFullHistoricalLaunchError(
      "UNSUPPORTED_QUALIFICATION_MODE",
      `Unsupported qualification mode for control replay bar source: ${input.qualificationReceipt.qualificationMode}`,
    );
  }

  const sessionDbPath = resolveFhvGenerationSessionDbPath(
    input.runDir,
    input.launchExecution.authorizationClaim.fencingGeneration,
  );

  const backtest = await runFullHistoricalBacktest({
    runDir: input.runDir,
    runId: input.launchInput.runId,
    releaseSha: input.launchInput.releaseSha,
    organizationId: input.launchInput.organizationId,
    operatorId: input.launchInput.operatorId,
    configurationFreeze: input.configurationFreeze,
    bars,
    datasetRoot,
    qualificationMode: input.qualificationReceipt.qualificationMode,
    boundedFixture: input.launchInput.boundedFixture === true,
    includeHoldout,
    controlReplay: true,
    maxCycles: input.launchInput.maxCycles,
    sessionDbPath,
    walWriter: input.launchExecution.walWriter,
    authorizationClaim: input.launchExecution.authorizationClaim,
    claimPath: input.launchExecution.claimPath,
    checkpointConfig: input.launchExecution.checkpointConfig,
    resumeFromCycle: input.launchExecution.resumeFromCycle,
  });

  const semanticReproDigest = computeReplayReproContentDigest(
    stripRunIdentityForControlReplay(backtest.exportDocument),
  );

  const classification = input.launchInput.boundedFixture
    ? ("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS" as const)
    : ("FHV_CONTROL_REPLAY_CEREMONY_PASS" as const);

  const launchResult = buildControlReplayLaunchResult({
    classification,
    semanticReproDigest,
    backtest,
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
    backtest,
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
  backtest: RunBacktestResult;
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
    semanticReproDigest: input.semanticReproDigest,
    cycleCount: input.backtest.cycleCount,
    evidenceChain: {
      qualificationReceiptDigest: input.qualificationReceiptDigest,
      configurationFreezeDigest: input.configurationFreeze.configurationFreezeDigest,
      authorizationReceiptDigest: input.authorizationReceiptDigest,
      launchReceiptDigest: input.launchReceiptDigest,
      datasetContentDigest: input.configurationFreeze.datasetDigest,
      manifestSemanticDigest: input.configurationFreeze.manifestDigest,
      accountingStateDigest: input.backtest.accountingState
        ? computeAccountingSemanticDigest(input.backtest.accountingState)
        : undefined,
      htrPnlReportDigest: input.backtest.htrPnlReportV1
        ? computePayloadDigest(input.backtest.htrPnlReportV1 as unknown as Record<string, unknown>)
        : undefined,
      drawdownHwm: input.backtest.drawdownHwmState,
      checkpointRef: input.backtest.streamingManifestRef,
      fullHistoryRescanCount: getFullHistoryRescanCount(),
      holdoutStatus: "SEALED_NOT_ACCESSED" as const,
    },
    accountingFrontierState: input.backtest.accountingFrontierState,
    htrPnlReportV1: input.backtest.htrPnlReportV1,
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
