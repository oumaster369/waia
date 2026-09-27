import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getFullHistoryRescanCount } from "@/lib/trader/backtest/replay-runtime-metrics";
import {
  writeFileAtomicCompareAndReplace,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { assertFhvOfficialV2DatasetArtifactsPresent } from "@/lib/trader/market-data/fhv-official-v2-required";
import { streamOfficialPreHoldoutWalkForwardBars } from "@/lib/trader/market-data/fhv-bounded-bar-stream";
import type { HtxVolumeQualificationReceiptV1 } from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";
import { runChronologicalControlReplayV2 } from "@/lib/trader/observability/control-replay-chronological-v2-driver-v1";
import { writeFhvOfficialCampaignIdentity } from "@/lib/trader/observability/fhv-official-campaign-identity";
import type { FhvConfigurationFreezeV1 } from "@/lib/trader/observability/fhv-configuration-freeze";
import {
  loadOfficialSharedPortfolioBars,
  type FhvDatasetQualificationReceiptV1,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { revalidateFhvDatasetAtLaunch } from "@/lib/trader/observability/fhv-dataset-launch-guard";
import {
  consumeFhvControlReplayAuthorizationWithHistoryV1,
  FHV_CONTROL_REPLAY_METADATA_OPTIONS as metadataProfile,
  type FhvControlReplayTransitionInput,
} from "@/lib/trader/observability/fhv-full-historical-auth";
import { readMetadataBytesSync } from "@/lib/trader/backtest/streaming-evidence/bounded-metadata-read";
import {
  resolveFhvControlReplayRunDirectory,
  claimFhvControlReplayInitializationLock,
  releaseFhvControlReplayInitializationLock,
  assertFhvControlReplayFreshInitialization,
  publishFhvControlReplayInitializedTransitionV1,
  assertFhvControlReplayInitializedTransitionV1,
  expectedFhvControlReplayClaimIdentity,
  readFhvControlReplayTerminalLinkV1,
  FhvControlReplayTransitionError,
} from "@/lib/trader/observability/fhv-control-replay-authorization-transition";
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
  validateFhvFullHistoricalLaunchInput,
  writeFhvFullLaunchReceipt,
  type FhvFullHistoricalLaunchInput,
  type FhvFullHistoricalLaunchResult,
} from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { CONTROL_REPLAY_AUTHORITY_IDENTITY } from "@/lib/trader/observability/control-replay-test-authority";
import { V2_CAPITAL_AUTHORITY_PATH } from "@/lib/trader/risk/authority-chain";
import type { TestOnlyExecutionV2AuthorityPort } from "@/lib/trader/execution/v2/test-only-authority-port";

export const FHV_CONTROL_REPLAY_EXECUTION_PURPOSE = "CONTROL_REPLAY" as const;

export function resolveFhvControlReplayCycleBound(input: {
  maxCycles?: number;
}): number | undefined {
  return input.maxCycles;
}

export type FhvControlReplayLaunchInput = FhvFullHistoricalLaunchInput & {
  executionPurpose: typeof FHV_CONTROL_REPLAY_EXECUTION_PURPOSE;
  /** Human-authorized only for the nine admitted PostgreSQL test surfaces. */
  testOnlyExecutionV2Authority?: TestOnlyExecutionV2AuthorityPort;
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
  resumeFromCheckpoint?: boolean;
}): Promise<FhvFullHistoricalLaunchResult> {
  // Preserve launch-shell dataset presence gates (no holdout; no FULL_HISTORICAL economics).
  if (input.launchInput.boundedFixture) {
    // bounded fixture: launch shell only — economic authority is scientific V2 below
  } else if (input.qualificationReceipt.qualificationMode === "OFFICIAL_MULTI_YEAR") {
    assertFhvOfficialV2DatasetArtifactsPresent({
      datasetRoot: input.launchInput.datasetRoot!,
      qualificationMode: input.qualificationReceipt.qualificationMode,
    });
  } else if (input.qualificationReceipt.qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA") {
    // Dataset presence is the pre-holdout package; do not require full V2 seal or holdout bars.
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

  if (input.qualificationReceipt.qualificationMode === "OFFICIAL_PRE_HOLDOUT_REAL_DATA") {
    const datasetRoot = input.launchInput.datasetRoot!;
    const chronological = await runChronologicalControlReplayV2({
      runId: input.launchInput.runId,
      runDir: input.runDir,
      organizationId: input.launchInput.organizationId,
      releaseSha: input.launchInput.releaseSha.trim().toLowerCase(),
      developmentWalkForwardContentDigest: input.qualificationReceipt.datasetContentDigest,
      executionBarStream: streamOfficialPreHoldoutWalkForwardBars(datasetRoot),
      economicReplayStartUtc: "2023-01-01T00:00:00.000Z",
      resumeFromCheckpoint: input.resumeFromCheckpoint === true,
      maxCycles: resolveFhvControlReplayCycleBound(input.launchInput),
      htxVolumeAuthorityByInstrument: {
        BTCUSDT: readControlReplayVolumeReceipt(datasetRoot, "BTCUSDT"),
        ETHUSDT: readControlReplayVolumeReceipt(datasetRoot, "ETHUSDT"),
      },
    });
    const chronologicalEvidencePath = join(
      input.runDir,
      "control-replay-chronological-v2-result.v1.json",
    );
    void chronologicalEvidencePath;
    const classification = "FHV_CONTROL_REPLAY_CEREMONY_PASS" as const;
    const launchResult = {
      schemaVersion: "fhv-full-launch-result/v1",
      classification,
      executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
      authorityClass: CONTROL_REPLAY_AUTHORITY_IDENTITY.authorityClass,
      capitalEligible: CONTROL_REPLAY_AUTHORITY_IDENTITY.capitalEligible,
      capitalAuthorityPath: V2_CAPITAL_AUTHORITY_PATH,
      driverVersion: chronological.driverVersion,
      completedStages: ["FORECAST", "DECISION", "DESIRED_SIZE", "PORTFOLIO", "RISK", "EXECUTION"],
      semanticReproDigest: chronological.normalizedParityDigest,
      cycleCount: chronological.cycleCount,
      evidenceChain: {
        qualificationReceiptDigest: input.qualificationReceiptDigest,
        configurationFreezeDigest: input.configurationFreeze.configurationFreezeDigest,
        authorizationReceiptDigest: input.launchInput.authorizationReceiptDigest,
        launchReceiptDigest: input.launchReceiptDigest,
        datasetContentDigest: input.configurationFreeze.datasetDigest,
        manifestSemanticDigest: input.configurationFreeze.manifestDigest,
        accountingStateDigest: chronological.accountingSemanticDigest,
        scientificParityDigest: chronological.parityDigest,
        packageContentDigestHex: chronological.packageContentDigestHex,
        scientificAdmissionReceiptDigest: chronological.scientificAdmissionReceiptDigest,
        executablePolicyDigest: "UNAVAILABLE",
        fullHistoryRescanCount: getFullHistoryRescanCount(),
        holdoutStatus: "PRE_HOLDOUT_ONLY_NOT_PRESENT_NOT_ACCESSED" as const,
        runDir: input.runDir,
      },
      accountingFrontierState: undefined,
      htrPnlReportV1: undefined,
    };
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
      semanticReproDigest: chronological.normalizedParityDigest,
      backtest: { cycleCount: chronological.cycleCount },
    };
  }

  const scientific = await runScientificControlReplayV2Ceremony({
    organizationId: input.launchInput.organizationId,
    testOnlyExecutionV2Authority: input.launchInput.testOnlyExecutionV2Authority,
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
    backtest: {
      cycleCount: launchResult.cycleCount,
    },
  };
}

export type FhvControlReplayLaunchResult = FhvFullHistoricalLaunchResult &
  Readonly<{
    authorizationTransition: Readonly<{
      issuedAuthorizationReceiptDigest: string;
      consumedAuthorizationReceiptDigest: string;
      pairDigest: string;
    }>;
    terminalLink: ReturnType<typeof readFhvControlReplayTerminalLinkV1>;
  }>;

function transitionInput(
  input: FhvControlReplayLaunchInput,
  freeze: FhvConfigurationFreezeV1,
  qualificationDigest: string,
): FhvControlReplayTransitionInput {
  const native = readFhvFullHistoricalAuthorizationReceipt(
    input.authorizationReceiptPath,
    metadataProfile,
  );
  return {
    artifactRoot: input.artifactRoot,
    runId: input.runId,
    authorizationReceiptPath: input.authorizationReceiptPath,
    expectedIdentity: {
      releaseSha: input.releaseSha.trim().toLowerCase(),
      releaseTag: input.releaseTag?.trim() ?? native.releaseTag,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
      runId: input.runId,
      datasetQualificationReceiptDigest: qualificationDigest,
      datasetDigest: freeze.datasetDigest,
      manifestDigest: freeze.manifestDigest,
      configurationFreezeDigest: freeze.configurationFreezeDigest,
    },
  };
}

export async function executeFhvControlReplayLaunch(
  input: FhvControlReplayLaunchInput,
): Promise<FhvControlReplayLaunchResult> {
  const request = { ...input };
  if (request.executionPurpose !== FHV_CONTROL_REPLAY_EXECUTION_PURPOSE) {
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_PURPOSE_REQUIRED",
      "executeFhvControlReplayLaunch requires executionPurpose CONTROL_REPLAY.",
    );
  }
  const runDir = resolveFhvControlReplayRunDirectory(request);
  assertCheckoutIdentity(request, runDir);
  const { configurationFreeze, qualificationReceipt, qualificationReceiptDigest } =
    validateFhvFullHistoricalLaunchInput(
      {
        ...request,
        controlReplayReceiptPath: undefined,
        holdoutAccessRequested: false,
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
      },
      metadataProfile,
    );
  if (!request.boundedFixture && request.datasetRoot && request.manifestPath)
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: request.datasetQualificationReceiptPath,
      datasetRoot: request.datasetRoot,
      manifestPath: request.manifestPath,
    });
  const identity = transitionInput(request, configurationFreeze, qualificationReceiptDigest);
  const lock = claimFhvControlReplayInitializationLock(runDir);
  let initialized: ReturnType<typeof assertFhvControlReplayInitializedTransitionV1>;
  let launchExecution: ReturnType<typeof prepareFhvOfficialLaunchExecution>;
  let receiptPath: string;
  try {
    assertFhvControlReplayFreshInitialization(identity);
    const transition = consumeFhvControlReplayAuthorizationWithHistoryV1({
      ...identity,
      expectedIssuedReceiptDigest: request.authorizationReceiptDigest,
    });
    const written = writeFhvFullLaunchReceipt(
      {
        configurationFreeze,
        authorizationReceiptDigest: transition.issued.authorizationReceiptDigest,
        datasetQualificationReceiptDigest: qualificationReceiptDigest,
        artifactRoot: request.artifactRoot,
        runId: request.runId,
        boundedFixture: request.boundedFixture,
      },
      metadataProfile,
    );
    receiptPath = written.receiptPath;
    writeFhvOfficialCampaignIdentity(
      {
        runDir,
        releaseSha: request.releaseSha.trim().toLowerCase(),
        runId: request.runId,
        organizationId: request.organizationId,
        launchReceiptDigest: written.receipt.launchReceiptDigest,
      },
      metadataProfile,
    );
    launchExecution = prepareFhvOfficialLaunchExecution({
      runDir,
      runId: request.runId,
      executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
      authorizationReceiptDigest: transition.issued.authorizationReceiptDigest,
      releaseSha: request.releaseSha,
      datasetContentDigest: configurationFreeze.datasetDigest,
      manifestSemanticDigest: configurationFreeze.manifestDigest,
      configurationFreeze,
      leaseOwner: `${request.operatorId}@${request.organizationId}`,
      ...metadataProfile,
    });
    initialized = publishFhvControlReplayInitializedTransitionV1(identity);
  } finally {
    releaseFhvControlReplayInitializationLock(lock);
  }
  const ai = initialized.transition.issued.authorizationReceiptDigest;
  const result = await runFhvControlReplayLaunchBacktest({
    launchInput: { ...request, authorizationReceiptDigest: ai },
    runDir,
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    launchExecution,
    launchReceiptDigest: initialized.launch.launchReceiptDigest,
  });
  return {
    ...result,
    receiptPath,
    authorizationTransition: {
      issuedAuthorizationReceiptDigest: ai,
      consumedAuthorizationReceiptDigest:
        initialized.transition.consumed.authorizationReceiptDigest,
      pairDigest: initialized.transition.pair.pairDigest,
    },
    terminalLink: readFhvControlReplayTerminalLinkV1(identity),
  };
}

export async function resumeFhvControlReplayLaunch(
  input: FhvControlReplayLaunchInput,
): Promise<FhvControlReplayLaunchResult> {
  const request = { ...input };
  if (request.executionPurpose !== FHV_CONTROL_REPLAY_EXECUTION_PURPOSE)
    throw new FhvFullHistoricalLaunchError(
      "CONTROL_REPLAY_PURPOSE_REQUIRED",
      "resumeFhvControlReplayLaunch requires executionPurpose CONTROL_REPLAY.",
    );
  const runDir = resolveFhvControlReplayRunDirectory(request);
  assertCheckoutIdentity(request, runDir);
  const { configurationFreeze, qualificationReceipt, qualificationReceiptDigest } =
    validateFhvFullHistoricalLaunchInput(
      {
        ...request,
        controlReplayReceiptPath: undefined,
        holdoutAccessRequested: false,
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
      },
      { resume: true, ...metadataProfile },
    );
  if (!request.boundedFixture && request.datasetRoot && request.manifestPath)
    revalidateFhvDatasetAtLaunch({
      datasetQualificationReceiptPath: request.datasetQualificationReceiptPath,
      datasetRoot: request.datasetRoot,
      manifestPath: request.manifestPath,
    });
  const identity = transitionInput(request, configurationFreeze, qualificationReceiptDigest);
  const lock = claimFhvControlReplayInitializationLock(runDir);
  let initialized: ReturnType<typeof assertFhvControlReplayInitializedTransitionV1>;
  let launchExecution: ReturnType<typeof prepareFhvOfficialLaunchExecution>;
  try {
    const claimPath = resolveFhvAuthorizationClaimPath(runDir);
    if (existsSync(`${claimPath}.claim.lock`))
      throw new FhvControlReplayTransitionError(
        "CLAIM_OWNERSHIP_UNRESOLVED",
        "Native claim lock exists; no automatic lock removal.",
      );
    initialized = assertFhvControlReplayInitializedTransitionV1(identity);
    if (initialized.claim.state !== "RUNNING")
      throw new FhvControlReplayTransitionError(
        "CLAIM_STATE_INVALID",
        "Strict resume requires the native RUNNING claim.",
      );
    const receiptBefore = readMetadataBytesSync(initialized.paths.launch, metadataProfile);
    recoverFhvExecutionWalForResume(runDir, metadataProfile);
    takeoverFhvAuthorizationRunning({
      claimPath,
      leaseOwner: `${request.operatorId}@${request.organizationId}`,
      expectedIdentity: expectedFhvControlReplayClaimIdentity(initialized.transition.issued),
      ...metadataProfile,
    });
    launchExecution = prepareFhvOfficialLaunchExecution({
      runDir,
      runId: request.runId,
      executionPurpose: FHV_EXECUTION_PURPOSE_CONTROL_REPLAY,
      authorizationReceiptDigest: initialized.transition.issued.authorizationReceiptDigest,
      releaseSha: request.releaseSha,
      datasetContentDigest: configurationFreeze.datasetDigest,
      manifestSemanticDigest: configurationFreeze.manifestDigest,
      configurationFreeze,
      leaseOwner: `${request.operatorId}@${request.organizationId}`,
      ...metadataProfile,
    });
    if (!readMetadataBytesSync(initialized.paths.launch, metadataProfile).equals(receiptBefore))
      throw new FhvFullHistoricalLaunchError(
        "LAUNCH_RECEIPT_REWRITE_FORBIDDEN",
        "Resume must not rewrite the launch receipt.",
      );
    initialized = assertFhvControlReplayInitializedTransitionV1(identity);
  } finally {
    releaseFhvControlReplayInitializationLock(lock);
  }
  const ai = initialized.transition.issued.authorizationReceiptDigest;
  const result = await runFhvControlReplayLaunchBacktest({
    launchInput: { ...request, authorizationReceiptDigest: ai },
    runDir,
    configurationFreeze,
    qualificationReceipt,
    qualificationReceiptDigest,
    launchExecution,
    launchReceiptDigest: initialized.launch.launchReceiptDigest,
    replaceLaunchResult: true,
    resumeFromCheckpoint: true,
  });
  return {
    ...result,
    authorizationTransition: {
      issuedAuthorizationReceiptDigest: ai,
      consumedAuthorizationReceiptDigest:
        initialized.transition.consumed.authorizationReceiptDigest,
      pairDigest: initialized.transition.pair.pairDigest,
    },
    terminalLink: readFhvControlReplayTerminalLinkV1(identity),
  };
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
  return readFhvFullHistoricalAuthorizationReceipt(receiptPath, metadataProfile)
    .authorizationReceiptDigest;
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

function readControlReplayVolumeReceipt(
  datasetRoot: string,
  symbol: "BTCUSDT" | "ETHUSDT",
): HtxVolumeQualificationReceiptV1 {
  const path = join(datasetRoot, "control", "volume", `htx-volume-qualification.${symbol}.v1.json`);
  if (!existsSync(path)) {
    throw new FhvFullHistoricalLaunchError(
      "HTX_VOLUME_AUTHORITY_MISSING",
      `Control Replay requires QUALIFIED HTX volume receipts; missing ${path}`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as HtxVolumeQualificationReceiptV1;
}
