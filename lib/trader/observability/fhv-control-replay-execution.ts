import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { loadApprovedBenchmarkFixture } from "@/lib/trader/backtest/replay-benchmark-harness";
import type { RunBacktestResult } from "@/lib/trader/backtest/backtest-runner";
import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import { writeFileAtomicExclusive } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import type { Bar } from "@/lib/trader/intelligence/types";
import { loadOfficialSharedPortfolioBars } from "@/lib/trader/observability/fhv-dataset-qualification";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import { consumeFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { runFullHistoricalBacktest } from "@/lib/trader/observability/fhv-full-historical-engine";
import {
  assertCheckoutIdentity,
  FhvFullHistoricalLaunchError,
  resolveFhvFullLaunchRunDirectory,
  stripRunIdentityForControlReplay,
  validateFhvFullHistoricalLaunchInput,
  writeFhvFullLaunchReceipt,
  type FhvFullHistoricalLaunchInput,
  type FhvFullHistoricalLaunchResult,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { computeReplayReproContentDigest } from "@/lib/trader/research/replay-repro-digest";

export const FHV_CONTROL_REPLAY_EXECUTION_PURPOSE = "CONTROL_REPLAY" as const;

export type FhvControlReplayLaunchInput = FhvFullHistoricalLaunchInput & {
  executionPurpose: typeof FHV_CONTROL_REPLAY_EXECUTION_PURPOSE;
};

export async function executeFhvControlReplayLaunch(
  input: FhvControlReplayLaunchInput,
): Promise<FhvFullHistoricalLaunchResult> {
  if (input.executionPurpose !== FHV_CONTROL_REPLAY_EXECUTION_PURPOSE) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_PURPOSE_REQUIRED",
      "executeFhvControlReplayLaunch requires executionPurpose CONTROL_REPLAY.",
    );
  }

  const runDir = resolveFhvFullLaunchRunDirectory(input.artifactRoot, input.runId);
  assertCheckoutIdentity(input, runDir);

  const { configurationFreeze, qualificationReceiptDigest } = validateFhvFullHistoricalLaunchInput({
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

  let bars: readonly Bar[];
  const includeHoldout = false;

  if (input.boundedFixture) {
    bars = loadApprovedBenchmarkFixture().bars;
  } else {
    bars = loadOfficialSharedPortfolioBars({
      datasetRoot: input.datasetRoot!,
      includeHoldout,
    });
  }

  const backtest = await runFullHistoricalBacktest({
    runDir,
    runId: input.runId,
    releaseSha: input.releaseSha,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    configurationFreeze,
    bars,
    boundedFixture: input.boundedFixture === true,
    includeHoldout,
    maxCycles: input.maxCycles,
  });

  const semanticReproDigest = computeReplayReproContentDigest(
    stripRunIdentityForControlReplay(backtest.exportDocument),
  );

  const classification = input.boundedFixture
    ? ("BOUNDED_FULL_HISTORICAL_END_TO_END_PASS" as const)
    : ("FULL_HISTORICAL_VALIDATION_COMPLETED" as const);

  const launchResult = buildControlReplayLaunchResult({
    classification,
    semanticReproDigest,
    backtest,
    qualificationReceiptDigest,
    configurationFreeze,
    authorizationReceiptDigest: input.authorizationReceiptDigest,
    launchReceiptDigest: receipt.launchReceiptDigest,
    runDir,
  });

  writeFileAtomicExclusive(
    join(runDir, "fhv-full-launch-result.v1.json"),
    `${JSON.stringify(launchResult, null, 2)}\n`,
  );

  return {
    classification,
    receiptPath,
    runDir,
    semanticReproDigest,
    backtest,
  };
}

function buildControlReplayLaunchResult(input: {
  classification:
    | "BOUNDED_FULL_HISTORICAL_END_TO_END_PASS"
    | "FULL_HISTORICAL_VALIDATION_COMPLETED";
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
