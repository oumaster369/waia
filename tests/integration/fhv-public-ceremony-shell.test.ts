/**
 * DEE-436 — FHV public ceremony shell integration (spawn CLIs on SCHEMA_INTEGRATION_FIXTURE).
 * Classification: PR452_PUBLIC_FHV_CEREMONY_END_TO_END_PASS
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  FHV_DATASET_QUALIFICATION_RECEIPT_FILENAME,
  FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { FHV_FULL_HISTORICAL_AUTHORIZATION_RECEIPT_FILENAME } from "@/lib/trader/observability/fhv-full-historical-auth";
import { FHV_T4_CHECKOUT_IDENTITY_FILENAME } from "@/lib/trader/observability/fhv-t4-release-checkout-identity";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-shell-integration-operator";
const RELEASE_TAG = "fhv-shell-ceremony-release";
const NODE = process.execPath;
const TSX_IMPORT = ["--import", "tsx"];
const SERVER_ONLY_PRELUDE = ["--require", "./scripts/trader/trader-cli-server-only-prelude.cjs"];
const REACT_SERVER = ["--conditions=react-server"];

function initCeremonyGitRepo(root: string): { repoPath: string; releaseSha: string } {
  const repoPath = join(root, "repo");
  mkdirSync(repoPath);
  execFileSync("git", ["-c", "init.templateDir=", "init"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "fhv-shell@test.local"], {
    cwd: repoPath,
    stdio: "pipe",
  });
  execFileSync("git", ["config", "user.name", "FHV Shell Test"], { cwd: repoPath, stdio: "pipe" });
  writeFileSync(join(repoPath, "README.md"), "fhv shell ceremony\n");
  execFileSync("git", ["add", "README.md"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "fhv shell ceremony init"], {
    cwd: repoPath,
    stdio: "pipe",
  });
  const releaseSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
    encoding: "utf8",
  }).trim();
  execFileSync("git", ["tag", RELEASE_TAG, releaseSha], { cwd: repoPath, stdio: "pipe" });
  return { repoPath, releaseSha };
}

function runClosureCli(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const { VITEST: _vitest, ...cliEnv } = env;
  const result = spawnSync(
    NODE,
    [
      ...TSX_IMPORT,
      ...SERVER_ONLY_PRELUDE,
      ...REACT_SERVER,
      "scripts/trader/fhv-t4-closure-cli.ts",
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...cliEnv,
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

function runCli(
  scriptPath: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const { VITEST: _vitest, ...cliEnv } = env;
  const result = spawnSync(
    NODE,
    [...TSX_IMPORT, ...SERVER_ONLY_PRELUDE, ...REACT_SERVER, scriptPath, "--", ...args],
    {
      cwd: process.cwd(),
      env: {
        ...cliEnv,
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

function recordCheckoutIdentity(input: {
  repoPath: string;
  releaseSha: string;
  runRoot: string;
  runId: string;
}): string {
  mkdirSync(join(input.runRoot, "control"), { recursive: true });
  const result = runClosureCli([
    "record-checkout-identity",
    "--repo-root",
    input.repoPath,
    "--target-sha",
    input.releaseSha,
    "--release-tag",
    RELEASE_TAG,
    "--run-root",
    input.runRoot,
    "--run-id",
    input.runId,
    "--organization-id",
    ORG_ID,
  ]);
  expect(result.status, `${result.stderr}\n${result.stdout}`).toBe(0);
  expect(result.stdout).toMatch(/FHV_T4_CHECKOUT_IDENTITY_PROOF_OK/);
  return join(input.runRoot, "control", FHV_T4_CHECKOUT_IDENTITY_FILENAME);
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
      const { repoPath, releaseSha } = initCeremonyGitRepo(root);
      const manifestPath = join(FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT, "fhv-dataset-manifest.json");

      const receiptDir = join(root, "qualification");
      const qualify = runCli("scripts/trader/fhv-dataset-qualification-cli.ts", [
        "--dataset-root",
        FHV_SCHEMA_INTEGRATION_FIXTURE_ROOT,
        "--manifest-path",
        manifestPath,
        "--qualification-mode",
        "SCHEMA_INTEGRATION_FIXTURE",
        "--release-sha",
        releaseSha,
        "--release-tag",
        RELEASE_TAG,
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

      const runOneId = `fhv-shell-replay-1-${releaseSha.slice(0, 8)}`;
      const runTwoId = `fhv-shell-replay-2-${releaseSha.slice(0, 8)}`;
      const fullRunId = `fhv-shell-full-${releaseSha.slice(0, 8)}`;

      const freezeOne = runCli("scripts/trader/fhv-freeze-config-cli.ts", [
        "--release-sha",
        releaseSha,
        "--release-tag",
        RELEASE_TAG,
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
        releaseSha,
        "--release-tag",
        RELEASE_TAG,
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
          releaseSha,
          "--release-tag",
          RELEASE_TAG,
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
          "--execution-purpose",
          "CONTROL_REPLAY",
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
          releaseSha,
          "--release-tag",
          RELEASE_TAG,
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
          "--execution-purpose",
          "CONTROL_REPLAY",
        ],
        {
          ...process.env,
          FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
        },
      );
      expect(authTwo.status, authTwo.stderr).toBe(0);
      const authTwoPath = parseAuthorizeReceiptPath(authTwo.stdout);

      const checkoutOne = recordCheckoutIdentity({
        repoPath,
        releaseSha,
        runRoot: join(root, "checkout-one"),
        runId: runOneId,
      });
      const checkoutTwo = recordCheckoutIdentity({
        repoPath,
        releaseSha,
        runRoot: join(root, "checkout-two"),
        runId: runTwoId,
      });

      const artifactRoot = join(root, "control-replay-runs");
      const controlReplayReceiptOutput = join(root, "fhv-control-replay-receipt.v1.json");
      const controlReplay = runCli("scripts/trader/fhv-control-replay-cli.ts", [
        "--release-sha",
        releaseSha,
        "--release-tag",
        RELEASE_TAG,
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
        manifestPath,
        "--checkout-identity-proof-path-run-one",
        checkoutOne,
        "--checkout-identity-proof-path-run-two",
        checkoutTwo,
        "--control-replay-receipt-output",
        controlReplayReceiptOutput,
      ]);
      expect(controlReplay.status, `${controlReplay.stderr}\n${controlReplay.stdout}`).toBe(0);
      expect(controlReplay.stdout).toContain("CONTROL_REPLAY=PASS");
      const controlReplayReceipt = JSON.parse(readFileSync(controlReplayReceiptOutput, "utf8"));
      expect(controlReplayReceipt.holdoutStatus).toBe("SEALED_NOT_ACCESSED");
      expect(controlReplayReceipt.digestsMatch).toBe(true);

      const finalFreeze = runCli("scripts/trader/fhv-freeze-config-cli.ts", [
        "--release-sha",
        releaseSha,
        "--release-tag",
        RELEASE_TAG,
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
          releaseSha,
          "--release-tag",
          RELEASE_TAG,
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

      const fullCheckout = recordCheckoutIdentity({
        repoPath,
        releaseSha,
        runRoot: join(root, "checkout-full"),
        runId: fullRunId,
      });
      const fullRunArtifactRoot = join(root, "full-run-artifacts");
      const fullRun = runCli(
        "scripts/trader/fhv-full-run-cli.ts",
        [
          "--release-sha",
          releaseSha,
          "--release-tag",
          RELEASE_TAG,
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
          manifestPath,
          "--checkout-identity-proof-path",
          fullCheckout,
          "--control-replay-receipt-path",
          controlReplayReceiptOutput,
        ],
        {
          ...process.env,
          FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
        },
      );
      expect(fullRun.status, `${fullRun.stderr}\n${fullRun.stdout}`).toBe(0);
      expect(fullRun.stdout).toContain("FHV_SCHEMA_INTEGRATION_CEREMONY_PASS");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 180_000);
});
