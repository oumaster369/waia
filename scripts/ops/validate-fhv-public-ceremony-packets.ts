/**
 * DEE-436 — executable FHV public ceremony packet ↔ CLI contract validator.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const DATASET_PACKET = join(ROOT, "docs/ops/FHV-DATASET-QUALIFICATION-PACKET.md");
const CONTROL_REPLAY_PACKET = join(ROOT, "docs/ops/FHV-CONTROL-REPLAY-PACKET.md");
const FULL_LAUNCH_PACKET = join(ROOT, "docs/ops/FHV-FULL-HISTORICAL-LAUNCH-PACKET.md");

function fail(message: string): never {
  console.error(`validate-fhv-public-ceremony-packets: ${message}`);
  process.exit(1);
}

function readPacket(path: string): string {
  return readFileSync(path, "utf8");
}

function assertCeremonyStepOrder(combined: string): void {
  const ceremonySteps = [
    { marker: "trader:fhv:acquire-htx-v2", label: "step 1 acquire-htx-v2" },
    { marker: "trader:fhv:seal-v2-dataset", label: "step 2 seal-v2-dataset" },
    { marker: "trader:fhv:validate-v2-dataset", label: "step 3 validate-v2-dataset" },
    { marker: "trader:fhv:dataset-qualify", label: "step 4 dataset-qualify" },
    { marker: "trader:fhv:freeze-config", label: "step 5 freeze-config (run one)" },
    {
      marker: "trader:fhv:authorize-full",
      label: "step 6 authorize-full (run one)",
      afterIndex: 0,
    },
    {
      marker: "trader:fhv:t4:record-checkout-identity",
      label: "step 7 checkout proof (run one)",
      afterIndex: 0,
    },
    { marker: "trader:fhv:freeze-config", label: "step 8 freeze-config (run two)", afterIndex: 1 },
    {
      marker: "trader:fhv:authorize-full",
      label: "step 9 authorize-full (run two)",
      afterIndex: 1,
    },
    {
      marker: "trader:fhv:t4:record-checkout-identity",
      label: "step 10 checkout proof (run two)",
      afterIndex: 1,
    },
    { marker: "trader:fhv:control-replay", label: "step 11 control-replay" },
    { marker: "trader:fhv:freeze-config", label: "step 12 freeze-config (final)", afterIndex: 2 },
    {
      marker: "trader:fhv:authorize-full",
      label: "step 13 authorize-full (final)",
      afterIndex: 2,
    },
    {
      marker: "trader:fhv:t4:record-checkout-identity",
      label: "step 14 checkout proof (final)",
      afterIndex: 2,
    },
    { marker: "trader:fhv:run", label: "step 15 run" },
  ] as const;

  let lastIndex = -1;
  const markerCounts = new Map<string, number>();

  for (const step of ceremonySteps) {
    const seen = markerCounts.get(step.marker) ?? 0;
    const fromIndex = lastIndex + 1;
    const index = combined.indexOf(step.marker, fromIndex);
    if (index === -1) {
      fail(`public ceremony packets missing ${step.label} (${step.marker})`);
    }
    if ("afterIndex" in step && step.afterIndex !== undefined && seen !== step.afterIndex) {
      fail(`public ceremony packets missing expected occurrence ${seen + 1} of ${step.marker}`);
    }
    if (index < lastIndex) {
      fail(`public ceremony order contradicts executable chain at ${step.label}`);
    }
    markerCounts.set(step.marker, seen + 1);
    lastIndex = index;
  }

  const acquireCount = combined.split("trader:fhv:acquire-htx-v2").length - 1;
  if (acquireCount < 6) {
    fail("public ceremony packets must document six trader:fhv:acquire-htx-v2 invocations");
  }
}

function assertExecutionPurposeBindings(combined: string): void {
  const controlReplayBindings = [
    combined.indexOf("executionPurpose=CONTROL_REPLAY"),
    combined.indexOf("--execution-purpose CONTROL_REPLAY"),
    combined.indexOf('executionPurpose: "CONTROL_REPLAY"'),
  ].filter((index) => index >= 0);
  if (controlReplayBindings.length < 2) {
    fail("public ceremony packets must document executionPurpose=CONTROL_REPLAY for both CR runs");
  }

  const fullHistoricalBindings = [
    combined.indexOf("executionPurpose=FULL_HISTORICAL"),
    combined.indexOf("--execution-purpose FULL_HISTORICAL"),
    combined.indexOf('executionPurpose: "FULL_HISTORICAL"'),
  ].filter((index) => index >= 0);
  if (fullHistoricalBindings.length === 0) {
    fail("public ceremony packets must document executionPurpose=FULL_HISTORICAL for final launch");
  }

  const controlReplayFirst = Math.min(...controlReplayBindings);
  const fullHistoricalFirst = Math.min(...fullHistoricalBindings);
  if (fullHistoricalFirst <= controlReplayFirst) {
    fail("FULL_HISTORICAL executionPurpose must appear after CONTROL_REPLAY bindings");
  }

  if (!combined.includes("controlReplayReceiptDigest")) {
    fail(
      "public ceremony packets must bind controlReplayReceiptDigest for FULL_HISTORICAL authorization",
    );
  }
}

function assertDatasetPacket(body: string): void {
  if (!body.includes("--receipt-dir")) {
    fail("dataset packet must document --receipt-dir");
  }
  if (body.includes("--output")) {
    fail("dataset packet must not document obsolete --output flag");
  }
  if (!body.includes("OFFICIAL_MULTI_YEAR")) {
    fail("dataset packet must document OFFICIAL_MULTI_YEAR qualification mode");
  }
  if (!body.includes("pnpm trader:fhv:dataset-qualify")) {
    fail("dataset packet must invoke trader:fhv:dataset-qualify");
  }
  if (!body.includes("pnpm trader:fhv:acquire-htx-v2")) {
    fail("dataset packet must invoke trader:fhv:acquire-htx-v2");
  }
  if (!body.includes("pnpm trader:fhv:seal-v2-dataset")) {
    fail("dataset packet must invoke trader:fhv:seal-v2-dataset");
  }
  if (!body.includes("pnpm trader:fhv:validate-v2-dataset")) {
    fail("dataset packet must invoke trader:fhv:validate-v2-dataset");
  }
}

function assertControlReplayPacket(body: string): void {
  const requiredFlags = [
    "--run-one-id",
    "--run-two-id",
    "--configuration-freeze-path-run-two",
    "--authorization-receipt-path-run-two",
    "--checkout-identity-proof-path-run-one",
    "--checkout-identity-proof-path-run-two",
    "--control-replay-receipt-output",
  ] as const;
  for (const flag of requiredFlags) {
    if (!body.includes(flag)) {
      fail(`control replay packet missing required flag ${flag}`);
    }
  }
  if (body.match(/--checkout-identity-proof-path[^-\n]/)) {
    fail("control replay packet must not document obsolete --checkout-identity-proof-path");
  }
  if (!body.includes("pnpm trader:fhv:control-replay")) {
    fail("control replay packet must invoke trader:fhv:control-replay");
  }
}

function assertFullLaunchPacket(body: string): void {
  if (!body.includes("FHV_SCHEMA_INTEGRATION_CEREMONY_PASS")) {
    fail("full launch packet must document FHV_SCHEMA_INTEGRATION_CEREMONY_PASS terminal class");
  }
  if (!body.includes("FULL_HISTORICAL_VALIDATION_COMPLETED")) {
    fail("full launch packet must document FULL_HISTORICAL_VALIDATION_COMPLETED terminal class");
  }
  if (!body.includes("--control-replay-receipt-path")) {
    fail("full launch packet must document --control-replay-receipt-path for holdout launch");
  }
  if (!body.includes("pnpm trader:fhv:t4:record-checkout-identity")) {
    fail("full launch packet must document record-checkout-identity ceremony step");
  }
  if (!body.includes("pnpm trader:fhv:run")) {
    fail("full launch packet must invoke trader:fhv:run");
  }
  if (body.includes("trader:fhv:full-run")) {
    fail("full launch packet must not document obsolete trader:fhv:full-run command");
  }
}

function main(): void {
  const datasetBody = readPacket(DATASET_PACKET);
  const controlReplayBody = readPacket(CONTROL_REPLAY_PACKET);
  const fullLaunchBody = readPacket(FULL_LAUNCH_PACKET);
  const combined = `${datasetBody}\n${controlReplayBody}\n${fullLaunchBody}`;

  assertDatasetPacket(datasetBody);
  assertControlReplayPacket(controlReplayBody);
  assertFullLaunchPacket(fullLaunchBody);
  assertCeremonyStepOrder(combined);
  assertExecutionPurposeBindings(combined);
  console.log("validate-fhv-public-ceremony-packets: OK");
}

main();
