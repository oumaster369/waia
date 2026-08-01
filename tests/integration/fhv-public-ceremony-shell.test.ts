/**
 * DEE-436 — FHV public ceremony shell integration (spawn CLIs on SCHEMA_INTEGRATION_FIXTURE).
 * Classification: PR452_PUBLIC_FHV_CEREMONY_END_TO_END_PASS
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME,
  FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME } from "@/lib/trader/observability/fhv-full-historical-auth";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  writeFhvTestCheckoutIdentityProof,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-shell-integration-operator";
const NODE = process.execPath;
const TSX_IMPORT = ["--import", "tsx"];
const SERVER_ONLY_PRELUDE = ["--require", "./scripts/trader/trader-cli-server-only-prelude.cjs"];
const REACT_SERVER = ["--conditions=react-server"];

function runCli(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    NODE,
    [...TSX_IMPORT, ...SERVER_ONLY_PRELUDE, ...REACT_SERVER, scriptPath, "--", ...args],
    {
      cwd: process.cwd(),
      env: {
        ...env,
        WAIA_TRADER_CLI: "1",
      },
      encoding: "utf8",
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function parseFreezeArtifactPath(stdout: string): string {
  const match = stdout.match(/artifact=(\S+)/);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

function parseAuthorizeReceiptPath(stdout: string): string {
  const match = stdout.match(/receipt=(\S+)/);
  expect(match?.[1]).toBeTruthy();
  return match![1]!;
}

describe("DEE-436 FHV public ceremony shell integration", () => {
  it("runs complete public CLI chain: qualify → freeze → auth → control-replay → authorize-full → full-run", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-shell-ceremony-"));
    try {
      const receiptDir = join(root, "qualification");
      const qualify = runCli("scripts/trader/fhv-dataset-qualification-cli.ts", [
        "--dataset-root",
        FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
        "--manifest-path",
        FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        "--qualification-mode",
        "SCHEMA_INTEGRATION_FIXTURE",
        "--release-sha",
        FHV_TEST_RELEASE_SHA,
        "--release-tag",
        FHV_TEST_RELEASE_TAG,
        "--organization-id",
        ORG_ID,
        "--operator-id",
        OPERATOR_ID,
        "--receipt-dir",
        receiptDir,
      ]);
      expect(qualify.status, qualify.stderr).toBe(0);
      expect(qualify.stdout).toContain("DATASET_QUALIFICATION=PASS");
      const qualificationReceiptPath = join(receiptDir, FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME);

      const runOneId = `fhv-shell-replay-1-${FHV_TEST_RELEASE_SHA.slice(0, 8)}`;
      const runTwoId = `fhv-shell-replay-2-${FHV_TEST_RELEASE_SHA.slice(0, 8)}`;
      const fullRunId = `fhv-shell-full-${FHV_TEST_RELEASE_SHA.slice(0, 8)}`;

      const freezeOne = runCli("scripts/trader/fhv-freeze-config-cli.ts", [
        "--release-sha",
        FHV_TEST_RELEASE_SHA,
        "--release-tag",
        FHV_TEST_RELEASE_TAG,
        "--run-id",
        runOneId,
        "--organization-id",
        ORG_ID,
        "--operator-id",
        OPERATOR_ID,
        "--artifact-dir",
        join(root, "freeze-one"),
        "--qualification-receipt-path",
        qualificationReceiptPath,
      ]);
      expect(freezeOne.status, freezeOne.stderr).toBe(0);
      const freezeOnePath = parseFreezeArtifactPath(freezeOne.stdout);

      const freezeTwo = runCli("scripts/trader/fhv-freeze-config-cli.ts", [
        "--release-sha",
        FHV_TEST_RELEASE_SHA,
        "--release-tag",
        FHV_TEST_RELEASE_TAG,
        "--run-id",
        runTwoId,
        "--organization-id",
        ORG_ID,
        "--operator-id",
        OPERATOR_ID,
        "--artifact-dir",
        join(root, "freeze-two"),
        "--qualification-receipt-path",
        qualificationReceiptPath,
      ]);
      expect(freezeTwo.status, freezeTwo.stderr).toBe(0);
      const freezeTwoPath = parseFreezeArtifactPath(freezeTwo.stdout);

      const authOne = runCli(
        "scripts/trader/fhv-authorize-full-cli.ts",
        [
          "--release-sha",
          FHV_TEST_RELEASE_SHA,
          "--release-tag",
          FHV_TEST_RELEASE_TAG,
          "--run-id",
          runOneId,
          "--organization-id",
          ORG_ID,
          "--operator-id",
          OPERATOR_ID,
          "--receipt-dir",
          join(root, "auth-one"),
          "--configuration-freeze-path",
          freezeOnePath,
          "--qualification-receipt-path",
          qualificationReceiptPath,
        ],
        {
          ...process.env,
          FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
        },
      );
      expect(authOne.status, authOne.stderr).toBe(0);
      const authOnePath = parseAuthorizeReceiptPath(authOne.stdout);

      const authTwo = runCli(
        "scripts/trader/fhv-authorize-full-cli.ts",
        [
          "--release-sha",
          FHV_TEST_RELEASE_SHA,
          "--release-tag",
          FHV_TEST_RELEASE_TAG,
          "--run-id",
          runTwoId,
          "--organization-id",
          ORG_ID,
          "--operator-id",
          OPERATOR_ID,
          "--receipt-dir",
          join(root, "auth-two"),
          "--configuration-freeze-path",
          freezeTwoPath,
          "--qualification-receipt-path",
          qualificationReceiptPath,
        ],
        {
          ...process.env,
          FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
        },
      );
      expect(authTwo.status, authTwo.stderr).toBe(0);
      const authTwoPath = parseAuthorizeReceiptPath(authTwo.stdout);

      const checkoutOne = writeFhvTestCheckoutIdentityProof({
        proofDir: join(root, "checkout-one"),
        releaseSha: FHV_TEST_RELEASE_SHA,
        runId: runOneId,
        organizationId: ORG_ID,
      });
      const checkoutTwo = writeFhvTestCheckoutIdentityProof({
        proofDir: join(root, "checkout-two"),
        releaseSha: FHV_TEST_RELEASE_SHA,
        runId: runTwoId,
        organizationId: ORG_ID,
      });

      const artifactRoot = join(root, "control-replay-runs");
      const controlReplayReceiptOutput = join(root, "fhv-control-replay-receipt.v1.json");
      const controlReplay = runCli(
        "scripts/trader/fhv-control-replay-cli.ts",
        [
          "--release-sha",
          FHV_TEST_RELEASE_SHA,
          "--release-tag",
          FHV_TEST_RELEASE_TAG,
          "--organization-id",
          ORG_ID,
          "--operator-id",
          OPERATOR_ID,
          "--run-one-id",
          runOneId,
          "--run-two-id",
          runTwoId,
          "--artifact-root",
          artifactRoot,
          "--configuration-freeze-path",
          freezeOnePath,
          "--configuration-freeze-path-run-two",
          freezeTwoPath,
          "--authorization-receipt-path",
          authOnePath,
          "--authorization-receipt-path-run-two",
          authTwoPath,
          "--dataset-qualification-receipt-path",
          qualificationReceiptPath,
          "--dataset-root",
          FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
          "--manifest-path",
          FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
          "--checkout-identity-proof-path-run-one",
          checkoutOne,
          "--checkout-identity-proof-path-run-two",
          checkoutTwo,
          "--control-replay-receipt-output",
          controlReplayReceiptOutput,
        ],
        {
          ...process.env,
          FHV_CHECKOUT_IDENTITY_TEST_BYPASS: "true",
        },
      );
      expect(controlReplay.status, `${controlReplay.stderr}\n${controlReplay.stdout}`).toBe(0);
      expect(controlReplay.stdout).toContain("CONTROL_REPLAY=PASS");
      const controlReplayReceipt = JSON.parse(readFileSync(controlReplayReceiptOutput, "utf8"));
      expect(controlReplayReceipt.holdoutStatus).toBe("SEALED_NOT_ACCESSED");
      expect(controlReplayReceipt.digestsMatch).toBe(true);

      const finalFreeze = runCli("scripts/trader/fhv-freeze-config-cli.ts", [
        "--release-sha",
        FHV_TEST_RELEASE_SHA,
        "--release-tag",
        FHV_TEST_RELEASE_TAG,
        "--run-id",
        fullRunId,
        "--organization-id",
        ORG_ID,
        "--operator-id",
        OPERATOR_ID,
        "--artifact-dir",
        join(root, "freeze-final"),
        "--qualification-receipt-path",
        qualificationReceiptPath,
      ]);
      expect(finalFreeze.status, finalFreeze.stderr).toBe(0);
      const finalFreezePath = parseFreezeArtifactPath(finalFreeze.stdout);

      const authReceiptDir = join(root, "full-auth");
      const authorizeFull = runCli(
        "scripts/trader/fhv-authorize-full-cli.ts",
        [
          "--release-sha",
          FHV_TEST_RELEASE_SHA,
          "--release-tag",
          FHV_TEST_RELEASE_TAG,
          "--run-id",
          fullRunId,
          "--organization-id",
          ORG_ID,
          "--operator-id",
          OPERATOR_ID,
          "--receipt-dir",
          authReceiptDir,
          "--configuration-freeze-path",
          finalFreezePath,
          "--qualification-receipt-path",
          qualificationReceiptPath,
          "--control-replay-receipt-path",
          controlReplayReceiptOutput,
        ],
        {
          ...process.env,
          FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
        },
      );
      expect(authorizeFull.status, authorizeFull.stderr).toBe(0);
      const fullAuthReceiptPath = join(
        authReceiptDir,
        FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME,
      );
      expect(readFileSync(fullAuthReceiptPath, "utf8")).toContain("controlReplayReceiptDigest");

      const fullCheckout = writeFhvTestCheckoutIdentityProof({
        proofDir: join(root, "checkout-full"),
        releaseSha: FHV_TEST_RELEASE_SHA,
        runId: fullRunId,
        organizationId: ORG_ID,
      });
      const fullRunArtifactRoot = join(root, "full-run-artifacts");
      const fullRun = runCli(
        "scripts/trader/fhv-full-run-cli.ts",
        [
          "--release-sha",
          FHV_TEST_RELEASE_SHA,
          "--release-tag",
          FHV_TEST_RELEASE_TAG,
          "--run-id",
          fullRunId,
          "--organization-id",
          ORG_ID,
          "--operator-id",
          OPERATOR_ID,
          "--artifact-root",
          fullRunArtifactRoot,
          "--configuration-freeze-path",
          finalFreezePath,
          "--authorization-receipt-path",
          fullAuthReceiptPath,
          "--dataset-qualification-receipt-path",
          qualificationReceiptPath,
          "--dataset-root",
          FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
          "--manifest-path",
          FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
          "--checkout-identity-proof-path",
          fullCheckout,
          "--control-replay-receipt-path",
          controlReplayReceiptOutput,
        ],
        {
          ...process.env,
          FHV_CHECKOUT_IDENTITY_TEST_BYPASS: "true",
        },
      );
      expect(fullRun.status, `${fullRun.stderr}\n${fullRun.stdout}`).toBe(0);
      expect(fullRun.stdout).toContain("FULL_HISTORICAL_VALIDATION_COMPLETED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
