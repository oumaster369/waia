/**
 * DEE-436 — FHV control replay CLI (two-run digest compare).
 */

import { existsSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { computeAccountingSemanticDigest } from "@/lib/trader/accounting";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import {
  executeFhvControlReplayLaunch,
  FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
  readFhvControlReplayLaunchAuthorizationDigest,
  readFhvControlReplayLaunchCheckoutDigest,
  readFhvControlReplayLaunchFreezeDigest,
  resumeFhvControlReplayLaunch,
} from "@/lib/trader/observability/fhv-control-replay-execution";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { readFhvDatasetQualificationReceipt } from "@/lib/trader/observability/fhv-dataset-qualification";
import { writeFhvControlReplayReceiptAtomic } from "@/lib/trader/observability/fhv-control-replay-receipt";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

export type FhvControlReplayResult = Readonly<{
  schemaVersion: "fhv-control-replay/v1";
  classification: "CONTROL_REPLAY=PASS" | "CONTROL_REPLAY=FAIL";
  runOneDigest?: string;
  runTwoDigest?: string;
  digestsMatch?: boolean;
  controlReplayReceiptPath?: string;
  failureReason?: string;
}>;

/**
 * Existing two-run Control Replay comparison (data plumbing only).
 * Does not invent cycle counts; missing/unequal counts fail closed.
 */
export function classifyFhvControlReplayPair(input: {
  runOneDigest?: string;
  runTwoDigest?: string;
  runOneCycleCount?: number;
  runTwoCycleCount?: number;
}): Pick<
  FhvControlReplayResult,
  "classification" | "digestsMatch" | "failureReason" | "runOneDigest" | "runTwoDigest"
> {
  const cycleCountsMatch =
    input.runOneCycleCount != null &&
    input.runTwoCycleCount != null &&
    input.runOneCycleCount === input.runTwoCycleCount;
  const digestsMatch =
    input.runOneDigest != null &&
    input.runTwoDigest != null &&
    input.runOneDigest === input.runTwoDigest &&
    cycleCountsMatch;
  if (!digestsMatch) {
    return {
      classification: "CONTROL_REPLAY=FAIL",
      runOneDigest: input.runOneDigest,
      runTwoDigest: input.runTwoDigest,
      digestsMatch: false,
      failureReason: cycleCountsMatch ? "SEMANTIC_REPRO_DIGEST_MISMATCH" : "CYCLE_COUNT_MISMATCH",
    };
  }
  return {
    classification: "CONTROL_REPLAY=PASS",
    runOneDigest: input.runOneDigest,
    runTwoDigest: input.runTwoDigest,
    digestsMatch: true,
  };
}

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    if (token === "--bounded-fixture" || token === "--resume") {
      parsed.set(token, true);
      continue;
    }
    const value = tokens[index + 1]?.trim();
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token}`);
    }
    parsed.set(token, value);
    index += 1;
  }
  return parsed;
}

export function resolveFhvControlReplayCliConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv.slice(2),
): {
  releaseSha: string;
  releaseTag?: string;
  organizationId: string;
  operatorId: string;
  runOneId: string;
  runTwoId: string;
  configurationFreezePath: string;
  configurationFreezePathRunTwo?: string;
  authorizationReceiptPath: string;
  authorizationReceiptPathRunTwo?: string;
  datasetQualificationReceiptPath: string;
  datasetRoot?: string;
  manifestPath?: string;
  artifactRoot?: string;
  checkoutIdentityProofPathRunOne?: string;
  checkoutIdentityProofPathRunTwo?: string;
  controlReplayReceiptOutput?: string;
  boundedFixture: boolean;
  resume?: boolean;
} {
  const flags = parseArgv(argv);
  const allowed = new Set([
    "--release-sha",
    "--release-tag",
    "--organization-id",
    "--operator-id",
    "--run-one-id",
    "--run-two-id",
    "--artifact-root",
    "--configuration-freeze-path",
    "--configuration-freeze-path-run-two",
    "--authorization-receipt-path",
    "--authorization-receipt-path-run-two",
    "--dataset-qualification-receipt-path",
    "--dataset-root",
    "--manifest-path",
    "--checkout-identity-proof-path-run-one",
    "--checkout-identity-proof-path-run-two",
    "--control-replay-receipt-output",
    "--bounded-fixture",
    "--resume",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag: ${key}`);
    }
  }

  const boundedFixture = flags.has("--bounded-fixture");
  const resume = flags.has("--resume");
  const releaseSha =
    (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim();
  const releaseTag =
    (flags.get("--release-tag") as string | undefined) ?? env.FHV_RELEASE_TAG?.trim();
  const organizationId =
    (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim();
  const operatorId =
    (flags.get("--operator-id") as string | undefined) ?? env.FHV_OPERATOR_ID?.trim();
  const runOneId = (flags.get("--run-one-id") as string | undefined) ?? env.FHV_RUN_ONE_ID?.trim();
  const runTwoId = (flags.get("--run-two-id") as string | undefined) ?? env.FHV_RUN_TWO_ID?.trim();
  const artifactRoot =
    (flags.get("--artifact-root") as string | undefined) ?? env.FHV_ARTIFACT_ROOT?.trim();
  const configurationFreezePath =
    (flags.get("--configuration-freeze-path") as string | undefined) ??
    env.FHV_CONFIGURATION_FREEZE_PATH?.trim();
  const configurationFreezePathRunTwo =
    (flags.get("--configuration-freeze-path-run-two") as string | undefined) ??
    env.FHV_CONFIGURATION_FREEZE_PATH_RUN_TWO?.trim();
  const authorizationReceiptPath =
    (flags.get("--authorization-receipt-path") as string | undefined) ??
    env.FHV_AUTHORIZATION_RECEIPT_PATH?.trim();
  const authorizationReceiptPathRunTwo =
    (flags.get("--authorization-receipt-path-run-two") as string | undefined) ??
    env.FHV_AUTHORIZATION_RECEIPT_PATH_RUN_TWO?.trim();
  const datasetQualificationReceiptPath =
    (flags.get("--dataset-qualification-receipt-path") as string | undefined) ??
    env.FHV_DATASET_QUALIFICATION_RECEIPT_PATH?.trim();
  const datasetRoot =
    (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim();
  const manifestPath =
    (flags.get("--manifest-path") as string | undefined) ?? env.FHV_MANIFEST_PATH?.trim();
  const checkoutIdentityProofPathRunOne =
    (flags.get("--checkout-identity-proof-path-run-one") as string | undefined) ??
    env.FHV_CHECKOUT_IDENTITY_PROOF_PATH_RUN_ONE?.trim();
  const checkoutIdentityProofPathRunTwo =
    (flags.get("--checkout-identity-proof-path-run-two") as string | undefined) ??
    env.FHV_CHECKOUT_IDENTITY_PROOF_PATH_RUN_TWO?.trim();
  const controlReplayReceiptOutput =
    (flags.get("--control-replay-receipt-output") as string | undefined) ??
    env.FHV_CONTROL_REPLAY_RECEIPT_OUTPUT?.trim();

  if (!releaseSha) {
    throw new Error("FHV_RELEASE_SHA or --release-sha required");
  }
  if (!FULL_SHA.test(releaseSha)) {
    throw new Error(`INVALID_RELEASE_SHA: ${releaseSha}`);
  }
  if (!configurationFreezePath) {
    throw new Error("--configuration-freeze-path required");
  }
  if (!authorizationReceiptPath) {
    throw new Error("--authorization-receipt-path required");
  }
  if (!datasetQualificationReceiptPath) {
    throw new Error("--dataset-qualification-receipt-path required");
  }

  const resolvedRunOneId =
    runOneId ?? (boundedFixture ? `fhv-control-replay-1-${releaseSha.slice(0, 8)}` : undefined);
  const resolvedRunTwoId =
    runTwoId ?? (boundedFixture ? `fhv-control-replay-2-${releaseSha.slice(0, 8)}` : undefined);

  if (boundedFixture) {
    if (!organizationId || !UUID_V4.test(organizationId)) {
      throw new Error(`INVALID_ORGANIZATION_ID: ${organizationId ?? "missing"}`);
    }
    if (!operatorId?.trim()) {
      throw new Error("INVALID_OPERATOR_ID: operator-id is required.");
    }
    if (!resolvedRunOneId || !RUN_ID_PATTERN.test(resolvedRunOneId)) {
      throw new Error("run-one-id is invalid.");
    }
    if (!resolvedRunTwoId || !RUN_ID_PATTERN.test(resolvedRunTwoId)) {
      throw new Error("run-two-id is invalid.");
    }
    return {
      releaseSha,
      releaseTag,
      organizationId,
      operatorId,
      runOneId: resolvedRunOneId,
      runTwoId: resolvedRunTwoId,
      configurationFreezePath,
      configurationFreezePathRunTwo,
      authorizationReceiptPath,
      authorizationReceiptPathRunTwo,
      datasetQualificationReceiptPath,
      datasetRoot,
      manifestPath,
      artifactRoot,
      checkoutIdentityProofPathRunOne,
      checkoutIdentityProofPathRunTwo,
      controlReplayReceiptOutput,
      boundedFixture,
      resume,
    };
  }

  if (!releaseTag?.trim()) {
    throw new Error("Official control replay requires --release-tag");
  }
  if (!organizationId || !UUID_V4.test(organizationId)) {
    throw new Error("Official control replay requires --organization-id (UUID v4)");
  }
  if (!operatorId?.trim()) {
    throw new Error("Official control replay requires --operator-id");
  }
  if (!resolvedRunOneId || !RUN_ID_PATTERN.test(resolvedRunOneId)) {
    throw new Error("Official control replay requires --run-one-id");
  }
  if (!resolvedRunTwoId || !RUN_ID_PATTERN.test(resolvedRunTwoId)) {
    throw new Error("Official control replay requires --run-two-id");
  }
  if (!artifactRoot) {
    throw new Error("Official control replay requires --artifact-root");
  }
  if (!datasetRoot || !manifestPath) {
    throw new Error("Official control replay requires --dataset-root and --manifest-path");
  }
  if (!checkoutIdentityProofPathRunOne || !checkoutIdentityProofPathRunTwo) {
    throw new Error(
      "Official control replay requires --checkout-identity-proof-path-run-one and --checkout-identity-proof-path-run-two",
    );
  }
  if (!controlReplayReceiptOutput) {
    throw new Error("Official control replay requires --control-replay-receipt-output");
  }
  if (!configurationFreezePathRunTwo) {
    throw new Error("Official control replay requires --configuration-freeze-path-run-two");
  }
  if (!authorizationReceiptPathRunTwo) {
    throw new Error("Official control replay requires --authorization-receipt-path-run-two");
  }
  if (configurationFreezePath === configurationFreezePathRunTwo) {
    throw new Error("Official control replay requires distinct configuration freeze paths");
  }
  if (authorizationReceiptPath === authorizationReceiptPathRunTwo) {
    throw new Error("Official control replay requires distinct authorization receipt paths");
  }
  if (checkoutIdentityProofPathRunOne === checkoutIdentityProofPathRunTwo) {
    throw new Error("Official control replay requires distinct checkout identity proof paths");
  }
  if (resolvedRunOneId === resolvedRunTwoId) {
    throw new Error("Official control replay requires distinct run-one-id and run-two-id");
  }

  return {
    releaseSha,
    releaseTag,
    organizationId,
    operatorId,
    runOneId: resolvedRunOneId,
    runTwoId: resolvedRunTwoId,
    configurationFreezePath,
    configurationFreezePathRunTwo,
    authorizationReceiptPath,
    authorizationReceiptPathRunTwo,
    datasetQualificationReceiptPath,
    datasetRoot,
    manifestPath,
    artifactRoot,
    checkoutIdentityProofPathRunOne,
    checkoutIdentityProofPathRunTwo,
    controlReplayReceiptOutput,
    boundedFixture,
    resume,
  };
}

export async function runFhvControlReplay(input: {
  releaseSha: string;
  releaseTag?: string;
  organizationId: string;
  operatorId: string;
  runOneId: string;
  runTwoId: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  datasetQualificationReceiptPath: string;
  datasetRoot?: string;
  manifestPath?: string;
  artifactRoot?: string;
  boundedFixture?: boolean;
  configurationFreezePathRunTwo?: string;
  authorizationReceiptPathRunTwo?: string;
  checkoutIdentityProofPathRunOne?: string;
  checkoutIdentityProofPathRunTwo?: string;
  controlReplayReceiptOutput?: string;
  maxCycles?: number;
  resume?: boolean;
}): Promise<FhvControlReplayResult> {
  if (!FULL_SHA.test(input.releaseSha)) {
    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=FAIL",
      failureReason: "INVALID_RELEASE_SHA",
    };
  }

  const artifactRoot = input.artifactRoot ?? mkdtempSync(join(tmpdir(), "fhv-control-replay-"));
  const boundedFixture = input.boundedFixture === true;

  try {
    readFhvConfigurationFreezeArtifact(input.configurationFreezePath);
    const qualificationReceipt = readFhvDatasetQualificationReceipt(
      input.datasetQualificationReceiptPath,
    );
    const authReceipt = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

    const freezePathTwo = boundedFixture
      ? (input.configurationFreezePathRunTwo ?? input.configurationFreezePath)
      : input.configurationFreezePathRunTwo!;
    const authReceiptTwoPath = boundedFixture
      ? (input.authorizationReceiptPathRunTwo ?? input.authorizationReceiptPath)
      : input.authorizationReceiptPathRunTwo!;
    const authReceiptTwo = readFhvFullHistoricalAuthorizationReceipt(authReceiptTwoPath);
    const checkoutProofRunOne = input.checkoutIdentityProofPathRunOne;
    const checkoutProofRunTwo = boundedFixture
      ? (input.checkoutIdentityProofPathRunTwo ?? input.checkoutIdentityProofPathRunOne)
      : input.checkoutIdentityProofPathRunTwo!;

    if (!boundedFixture) {
      if (input.runOneId === input.runTwoId) {
        return {
          schemaVersion: "fhv-control-replay/v1",
          classification: "CONTROL_REPLAY=FAIL",
          failureReason: "IDENTICAL_RUN_IDS",
        };
      }
      if (input.configurationFreezePath === freezePathTwo) {
        return {
          schemaVersion: "fhv-control-replay/v1",
          classification: "CONTROL_REPLAY=FAIL",
          failureReason: "IDENTICAL_FREEZE_PATHS",
        };
      }
      if (input.authorizationReceiptPath === authReceiptTwoPath) {
        return {
          schemaVersion: "fhv-control-replay/v1",
          classification: "CONTROL_REPLAY=FAIL",
          failureReason: "IDENTICAL_AUTHORIZATION_PATHS",
        };
      }
      if (checkoutProofRunOne === checkoutProofRunTwo) {
        return {
          schemaVersion: "fhv-control-replay/v1",
          classification: "CONTROL_REPLAY=FAIL",
          failureReason: "IDENTICAL_CHECKOUT_PROOF_PATHS",
        };
      }
    }

    const baseLaunch = {
      releaseSha: input.releaseSha,
      releaseTag: input.releaseTag,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
      artifactRoot,
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      boundedFixture,
      executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
      ...(input.maxCycles != null ? { maxCycles: input.maxCycles } : {}),
      ...(boundedFixture
        ? {}
        : {
            datasetRoot: input.datasetRoot,
            manifestPath: input.manifestPath,
          }),
    };

    const launchOne = input.resume ? resumeFhvControlReplayLaunch : executeFhvControlReplayLaunch;
    const launchTwo = input.resume ? resumeFhvControlReplayLaunch : executeFhvControlReplayLaunch;

    const resultOne = await launchOne({
      ...baseLaunch,
      runId: input.runOneId,
      configurationFreezePath: input.configurationFreezePath,
      authorizationReceiptPath: input.authorizationReceiptPath,
      authorizationReceiptDigest: authReceipt.authorizationReceiptDigest,
      ...(checkoutProofRunOne ? { checkoutIdentityProofPath: checkoutProofRunOne } : {}),
    });

    const resultTwo = await launchTwo({
      ...baseLaunch,
      runId: input.runTwoId,
      configurationFreezePath: freezePathTwo,
      authorizationReceiptPath: authReceiptTwoPath,
      authorizationReceiptDigest: authReceiptTwo.authorizationReceiptDigest,
      ...(checkoutProofRunTwo ? { checkoutIdentityProofPath: checkoutProofRunTwo } : {}),
    });

    const runOneDigest = resultOne.semanticReproDigest;
    const runTwoDigest = resultTwo.semanticReproDigest;
    const classified = classifyFhvControlReplayPair({
      runOneDigest,
      runTwoDigest,
      runOneCycleCount: resultOne.backtest?.cycleCount,
      runTwoCycleCount: resultTwo.backtest?.cycleCount,
    });

    if (classified.classification !== "CONTROL_REPLAY=PASS") {
      return {
        schemaVersion: "fhv-control-replay/v1",
        ...classified,
      };
    }

    let controlReplayReceiptPath: string | undefined;
    if (input.controlReplayReceiptOutput) {
      const freezeOneDigest = readFhvControlReplayLaunchFreezeDigest(input.configurationFreezePath);
      const freezeTwoDigest = readFhvControlReplayLaunchFreezeDigest(freezePathTwo);
      writeFhvControlReplayReceiptAtomic({
        receiptPath: input.controlReplayReceiptOutput,
        releaseSha: input.releaseSha,
        releaseTag: input.releaseTag ?? "unknown",
        organizationId: input.organizationId,
        operatorId: input.operatorId,
        runOneId: input.runOneId,
        runTwoId: input.runTwoId,
        runOneDigest: runOneDigest!,
        runTwoDigest: runTwoDigest!,
        datasetQualificationReceiptDigest: qualificationReceipt.qualificationReceiptDigest,
        datasetContentDigest: qualificationReceipt.datasetContentDigest,
        manifestSemanticDigest: qualificationReceipt.manifestSemanticDigest,
        runOneConfigurationFreezeDigest: freezeOneDigest,
        runTwoConfigurationFreezeDigest: freezeTwoDigest,
        runOneAuthorizationReceiptDigest: authReceipt.authorizationReceiptDigest,
        runTwoAuthorizationReceiptDigest: authReceiptTwo.authorizationReceiptDigest,
        runOneCheckoutIdentityProofDigest: checkoutProofRunOne
          ? readFhvControlReplayLaunchCheckoutDigest(checkoutProofRunOne)
          : "0000000000000000000000000000000000000000000000000000000000000000",
        runTwoCheckoutIdentityProofDigest: checkoutProofRunTwo
          ? readFhvControlReplayLaunchCheckoutDigest(checkoutProofRunTwo)
          : "0000000000000000000000000000000000000000000000000000000000000000",
        runOneCycleCount: resultOne.backtest!.cycleCount,
        runTwoCycleCount: resultTwo.backtest!.cycleCount,
        runOneAccountingStateDigest: resultOne.backtest?.accountingState
          ? computeAccountingSemanticDigest(resultOne.backtest.accountingState)
          : undefined,
        runTwoAccountingStateDigest: resultTwo.backtest?.accountingState
          ? computeAccountingSemanticDigest(resultTwo.backtest.accountingState)
          : undefined,
        runOneHtrPnlReportDigest: resultOne.backtest?.htrPnlReportV1
          ? computePayloadDigest(
              resultOne.backtest.htrPnlReportV1 as unknown as Record<string, unknown>,
            )
          : undefined,
        runTwoHtrPnlReportDigest: resultTwo.backtest?.htrPnlReportV1
          ? computePayloadDigest(
              resultTwo.backtest.htrPnlReportV1 as unknown as Record<string, unknown>,
            )
          : undefined,
      });
      controlReplayReceiptPath = input.controlReplayReceiptOutput;
    }

    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=PASS",
      runOneDigest,
      runTwoDigest,
      digestsMatch: true,
      controlReplayReceiptPath,
    };
  } catch (error) {
    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=FAIL",
      failureReason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  try {
    const config = resolveFhvControlReplayCliConfig();
    const result = await runFhvControlReplay(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`${result.classification}\n`);
    process.exitCode = result.classification === "CONTROL_REPLAY=PASS" ? 0 : 1;
  } catch (error) {
    process.stderr.write(`[fhv-control-replay] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]?.includes("fhv-control-replay-cli.ts") ?? false;

if (invokedDirectly) {
  void main();
}
