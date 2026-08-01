/**
 * DEE-436 — FHV control replay CLI (two-run digest compare).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvConfigurationFreezeArtifact } from "@/lib/trader/observability/fhv-configuration-freeze-artifact";
import { readFhvFullHistoricalAuthorizationReceipt } from "@/lib/trader/observability/fhv-full-historical-auth";
import { writeFhvControlReplayReceiptAtomic } from "@/lib/trader/observability/fhv-control-replay-receipt";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FhvControlReplayResult = Readonly<{
  schemaVersion: "fhv-control-replay/v1";
  classification: "CONTROL_REPLAY=PASS" | "CONTROL_REPLAY=FAIL";
  runOneDigest?: string;
  runTwoDigest?: string;
  digestsMatch?: boolean;
  controlReplayReceiptPath?: string;
  failureReason?: string;
}>;

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    if (token === "--bounded-fixture") {
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
  configurationFreezePath: string;
  configurationFreezePathRunTwo?: string;
  authorizationReceiptPath: string;
  authorizationReceiptPathRunTwo?: string;
  datasetQualificationReceiptPath: string;
  datasetRoot?: string;
  manifestPath?: string;
  artifactRoot?: string;
  checkoutIdentityProofPath?: string;
  controlReplayReceiptOutput?: string;
  boundedFixture: boolean;
} {
  const flags = parseArgv(argv);
  const allowed = new Set([
    "--release-sha",
    "--release-tag",
    "--organization-id",
    "--operator-id",
    "--artifact-root",
    "--configuration-freeze-path",
    "--configuration-freeze-path-run-two",
    "--authorization-receipt-path",
    "--authorization-receipt-path-run-two",
    "--dataset-qualification-receipt-path",
    "--dataset-root",
    "--manifest-path",
    "--checkout-identity-proof-path",
    "--control-replay-receipt-output",
    "--bounded-fixture",
  ]);
  for (const key of flags.keys()) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag: ${key}`);
    }
  }

  const releaseSha =
    (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim();
  const releaseTag =
    (flags.get("--release-tag") as string | undefined) ?? env.FHV_RELEASE_TAG?.trim();
  const organizationId =
    (flags.get("--organization-id") as string | undefined) ??
    env.FHV_ORGANIZATION_ID?.trim() ??
    "00000000-0000-4000-8000-000000000436";
  const operatorId =
    (flags.get("--operator-id") as string | undefined) ??
    env.FHV_OPERATOR_ID?.trim() ??
    "control-replay-operator";
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
  const checkoutIdentityProofPath =
    (flags.get("--checkout-identity-proof-path") as string | undefined) ??
    env.FHV_CHECKOUT_IDENTITY_PROOF_PATH?.trim();
  const controlReplayReceiptOutput =
    (flags.get("--control-replay-receipt-output") as string | undefined) ??
    env.FHV_CONTROL_REPLAY_RECEIPT_OUTPUT?.trim();
  const boundedFixture = flags.has("--bounded-fixture");

  if (!releaseSha) {
    throw new Error("FHV_RELEASE_SHA or --release-sha required");
  }
  if (!FULL_SHA.test(releaseSha)) {
    throw new Error(`INVALID_RELEASE_SHA: ${releaseSha}`);
  }
  if (!UUID_V4.test(organizationId)) {
    throw new Error(`INVALID_ORGANIZATION_ID: ${organizationId}`);
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
  if (!boundedFixture && (!datasetRoot || !manifestPath)) {
    throw new Error("Official control replay requires --dataset-root and --manifest-path");
  }
  if (!boundedFixture && !checkoutIdentityProofPath) {
    throw new Error("Official control replay requires --checkout-identity-proof-path");
  }

  return {
    releaseSha,
    releaseTag,
    organizationId,
    operatorId,
    configurationFreezePath,
    configurationFreezePathRunTwo,
    authorizationReceiptPath,
    authorizationReceiptPathRunTwo,
    datasetQualificationReceiptPath,
    datasetRoot,
    manifestPath,
    checkoutIdentityProofPath,
    controlReplayReceiptOutput,
    ...(artifactRoot ? { artifactRoot } : {}),
    boundedFixture,
  };
}

export async function runFhvControlReplay(input: {
  releaseSha: string;
  releaseTag?: string;
  organizationId: string;
  operatorId: string;
  configurationFreezePath: string;
  authorizationReceiptPath: string;
  datasetQualificationReceiptPath: string;
  datasetRoot?: string;
  manifestPath?: string;
  artifactRoot?: string;
  boundedFixture?: boolean;
  configurationFreezePathRunTwo?: string;
  authorizationReceiptPathRunTwo?: string;
  checkoutIdentityProofPath?: string;
  controlReplayReceiptOutput?: string;
  maxCycles?: number;
}): Promise<FhvControlReplayResult> {
  if (!FULL_SHA.test(input.releaseSha)) {
    return {
      schemaVersion: "fhv-control-replay/v1",
      classification: "CONTROL_REPLAY=FAIL",
      failureReason: "INVALID_RELEASE_SHA",
    };
  }

  const artifactRoot = input.artifactRoot ?? mkdtempSync(join(tmpdir(), "fhv-control-replay-"));
  const shouldCleanup = !input.artifactRoot;
  const boundedFixture = input.boundedFixture === true;

  try {
    readFhvConfigurationFreezeArtifact(input.configurationFreezePath);
    const authReceipt = readFhvFullHistoricalAuthorizationReceipt(input.authorizationReceiptPath);

    const runOneId = `fhv-control-replay-1-${input.releaseSha.slice(0, 8)}`;
    const runTwoId = `fhv-control-replay-2-${input.releaseSha.slice(0, 8)}`;

    const baseLaunch = {
      releaseSha: input.releaseSha,
      releaseTag: input.releaseTag,
      organizationId: input.organizationId,
      operatorId: input.operatorId,
      artifactRoot,
      configurationFreezePath: input.configurationFreezePath,
      datasetQualificationReceiptPath: input.datasetQualificationReceiptPath,
      boundedFixture,
      ...(input.maxCycles != null ? { maxCycles: input.maxCycles } : {}),
      ...(boundedFixture
        ? {}
        : {
            datasetRoot: input.datasetRoot,
            manifestPath: input.manifestPath,
            checkoutIdentityProofPath: input.checkoutIdentityProofPath,
          }),
    };

    const resultOne = await executeFhvFullHistoricalLaunch({
      ...baseLaunch,
      runId: runOneId,
      authorizationReceiptPath: input.authorizationReceiptPath,
      authorizationReceiptDigest: authReceipt.authorizationReceiptDigest,
    });

    const freezePathTwo = input.configurationFreezePathRunTwo ?? input.configurationFreezePath;
    const authReceiptTwoPath =
      input.authorizationReceiptPathRunTwo ?? input.authorizationReceiptPath;
    const authReceiptTwo = readFhvFullHistoricalAuthorizationReceipt(authReceiptTwoPath);

    const resultTwo = await executeFhvFullHistoricalLaunch({
      ...baseLaunch,
      runId: runTwoId,
      configurationFreezePath: freezePathTwo,
      authorizationReceiptPath: authReceiptTwoPath,
      authorizationReceiptDigest: authReceiptTwo.authorizationReceiptDigest,
    });

    const runOneDigest = resultOne.semanticReproDigest;
    const runTwoDigest = resultTwo.semanticReproDigest;
    const cycleCountsMatch =
      resultOne.backtest?.cycleCount != null &&
      resultTwo.backtest?.cycleCount != null &&
      resultOne.backtest.cycleCount === resultTwo.backtest.cycleCount;
    const digestsMatch =
      runOneDigest != null &&
      runTwoDigest != null &&
      runOneDigest === runTwoDigest &&
      cycleCountsMatch;

    if (!digestsMatch) {
      return {
        schemaVersion: "fhv-control-replay/v1",
        classification: "CONTROL_REPLAY=FAIL",
        runOneDigest,
        runTwoDigest,
        digestsMatch: false,
        failureReason: cycleCountsMatch ? "SEMANTIC_REPRO_DIGEST_MISMATCH" : "CYCLE_COUNT_MISMATCH",
      };
    }

    let controlReplayReceiptPath: string | undefined;
    if (input.controlReplayReceiptOutput) {
      writeFhvControlReplayReceiptAtomic({
        receiptPath: input.controlReplayReceiptOutput,
        releaseSha: input.releaseSha,
        organizationId: input.organizationId,
        operatorId: input.operatorId,
        runOneId,
        runTwoId,
        runOneDigest: runOneDigest!,
        runTwoDigest: runTwoDigest!,
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
  } finally {
    if (shouldCleanup) {
      rmSync(artifactRoot, { recursive: true, force: true });
    }
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
