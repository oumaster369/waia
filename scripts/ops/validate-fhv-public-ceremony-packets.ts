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
  const ceremonyOrder = [
    "trader:fhv:dataset-qualify",
    "trader:fhv:freeze-config",
    "trader:fhv:control-replay",
    "trader:fhv:authorize-full",
    "trader:fhv:t4:record-checkout-identity",
    "trader:fhv:run",
  ];
  let lastIndex = -1;
  for (const step of ceremonyOrder) {
    const index = body.indexOf(step);
    if (index === -1) {
      fail(`full launch packet missing ceremony step ${step}`);
    }
    if (index < lastIndex) {
      fail(`full launch packet ceremony order contradicts executable chain at ${step}`);
    }
    lastIndex = index;
  }
}

function main(): void {
  assertDatasetPacket(readPacket(DATASET_PACKET));
  assertControlReplayPacket(readPacket(CONTROL_REPLAY_PACKET));
  assertFullLaunchPacket(readPacket(FULL_LAUNCH_PACKET));
  console.log("validate-fhv-public-ceremony-packets: OK");
}

main();
