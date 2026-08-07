/**
 * DEE-436 — FHV public ceremony executability RED-1..RED-9 closure tests.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fork, type ChildProcess } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  buildFhvSharedPortfolioSnapshotsForTest,
  mergeFhvSharedPortfolioBarsChronologically,
} from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import {
  loadOfficialSharedPortfolioBars,
  qualifyFhvOfficialDataset,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import {
  executeFhvControlReplayLaunch,
  FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
} from "@/lib/trader/observability/fhv-control-replay-execution";
import { executeFhvFullHistoricalLaunch } from "@/lib/trader/observability/fhv-full-historical-launch";
import { readFhvControlReplayReceipt } from "@/lib/trader/observability/fhv-control-replay-receipt";
import { resolveFhvAuthorizeFullCliConfig } from "@/scripts/trader/fhv-authorize-full-cli";
import { resolveFhvControlReplayCliConfig } from "@/scripts/trader/fhv-control-replay-cli";
import { resolveFhvDatasetQualificationCliConfig } from "@/scripts/trader/fhv-dataset-qualification-cli";
import { resolveFhvFullRunCliConfig } from "@/scripts/trader/fhv-full-run-cli";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
  setupFhvOfficialSchemaLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-public-ceremony-operator";

function spawnAuthConsumeWorker(receiptPath: string, label: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = fork(
      "tests/helpers/fhv-auth-concurrent-consume-worker.ts",
      [receiptPath, label],
      {
        execArgv: ["--import", "tsx"],
        stdio: ["inherit", "inherit", "inherit", "ipc"],
      },
    );
    child.once("message", (message) => {
      if (message === "ready") {
        resolve(child);
      }
    });
    child.once("error", reject);
  });
}

describe("DEE-436 FHV public ceremony RED-1..RED-9", () => {
  it("RED-1: official full-run CLI requires control-replay-receipt-path", () => {
    expect(() =>
      resolveFhvFullRunCliConfig(
        {
          ...process.env,
          FHV_RELEASE_SHA: FHV_TEST_RELEASE_SHA,
          FHV_RUN_ID: "fhv-red1-run",
          FHV_ORGANIZATION_ID: ORG_ID,
          FHV_OPERATOR_ID: OPERATOR_ID,
          FHV_ARTIFACT_ROOT: "/tmp/fhv-red1-artifacts",
          FHV_CONFIGURATION_FREEZE_PATH: "/tmp/freeze.json",
          FHV_AUTHORIZATION_RECEIPT_PATH: "/tmp/auth.json",
          FHV_AUTHORIZATION_RECEIPT_DIGEST: "a".repeat(64),
          FHV_DATASET_QUALIFICATION_RECEIPT_PATH: "/tmp/qualify.json",
          FHV_DATASET_ROOT: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
          FHV_MANIFEST_PATH: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
          FHV_CHECKOUT_IDENTITY_PROOF_PATH: "/tmp/checkout.json",
        },
        [],
      ),
    ).toThrow(/control-replay-receipt-path/i);
  });

  it("RED-2/GREEN: authorize-full CLI binds control-replay-receipt-path when provided", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red2-"));
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red2-run",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const config = resolveFhvAuthorizeFullCliConfig(
        {
          ...process.env,
          FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
          FHV_RELEASE_SHA: FHV_TEST_RELEASE_SHA,
          FHV_RELEASE_TAG: FHV_TEST_RELEASE_TAG,
          FHV_RUN_ID: "fhv-red2-run",
          FHV_ORGANIZATION_ID: ORG_ID,
          FHV_OPERATOR_ID: OPERATOR_ID,
          FHV_RECEIPT_DIR: join(root, "receipts"),
          FHV_CONFIGURATION_FREEZE_PATH: prep.configurationFreezePath,
          FHV_QUALIFICATION_RECEIPT_PATH: prep.qualificationReceiptPath,
          FHV_CONTROL_REPLAY_RECEIPT_PATH: prep.controlReplayReceiptPath,
        },
        [],
      );
      expect(config.controlReplayReceipt?.controlReplayReceiptDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-3: full launch rejects CONTROL_REPLAY purpose; dedicated entry exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red3-"));
    const runId = "fhv-red3-control-replay";
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      await expect(
        executeFhvFullHistoricalLaunch({
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          runId,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
          artifactRoot: root,
          configurationFreezePath: prep.configurationFreezePath,
          authorizationReceiptPath: prep.authorizationReceiptPath,
          authorizationReceiptDigest: prep.authorizationReceiptDigest,
          datasetQualificationReceiptPath: prep.qualificationReceiptPath,
          checkoutIdentityProofPath: prep.checkoutIdentityProofPath,
          boundedFixture: true,
          executionPurpose: "CONTROL_REPLAY",
        }),
      ).rejects.toMatchObject({ code: "CONTROL_REPLAY_USE_DEDICATED_ENTRY" });

      const prepTwo = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: `${runId}-dedicated`,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        prepSuffix: "dedicated-auth",
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
      });
      const dedicated = await executeFhvControlReplayLaunch({
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        runId: `${runId}-dedicated`,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
        artifactRoot: root,
        configurationFreezePath: prepTwo.configurationFreezePath,
        authorizationReceiptPath: prepTwo.authorizationReceiptPath,
        authorizationReceiptDigest: prepTwo.authorizationReceiptDigest,
        datasetQualificationReceiptPath: prepTwo.qualificationReceiptPath,
        checkoutIdentityProofPath: prepTwo.checkoutIdentityProofPath,
        boundedFixture: true,
        executionPurpose: FHV_CONTROL_REPLAY_EXECUTION_PURPOSE,
        maxCycles: 5,
      });
      expect(dedicated.semanticReproDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-4: official control replay CLI requires dual checkout proofs and run ids", () => {
    expect(() =>
      resolveFhvControlReplayCliConfig(process.env, [
        "--release-sha",
        FHV_TEST_RELEASE_SHA,
        "--release-tag",
        FHV_TEST_RELEASE_TAG,
        "--organization-id",
        ORG_ID,
        "--operator-id",
        OPERATOR_ID,
        "--configuration-freeze-path",
        "/tmp/freeze.json",
        "--authorization-receipt-path",
        "/tmp/auth.json",
        "--dataset-qualification-receipt-path",
        "/tmp/qualify.json",
        "--dataset-root",
        FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        "--manifest-path",
        FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        "--artifact-root",
        "/tmp/fhv-red4-artifacts",
      ]),
    ).toThrow(/run-one-id/i);
  });

  it("RED-5: control replay receipt binds extended ceremony fields", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red5-"));
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red5-run",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const receipt = readFhvControlReplayReceipt(prep.controlReplayReceiptPath);
      expect(receipt.releaseTag).toBe(FHV_TEST_RELEASE_TAG);
      expect(receipt.datasetQualificationReceiptDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.datasetContentDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.manifestSemanticDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runOneConfigurationFreezeDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runTwoConfigurationFreezeDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runOneAuthorizationReceiptDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runTwoAuthorizationReceiptDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runOneCheckoutIdentityProofDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runTwoCheckoutIdentityProofDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.runOneCycleCount).toBeGreaterThan(0);
      expect(receipt.runTwoCycleCount).toBeGreaterThan(0);
      expect(receipt.holdoutStatus).toBe("SEALED_NOT_ACCESSED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-6: OFFICIAL_MULTI_YEAR dataset qualification CLI requires public bindings", () => {
    expect(() =>
      resolveFhvDatasetQualificationCliConfig(process.env, [
        "--dataset-root",
        FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        "--manifest-path",
        FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        "--qualification-mode",
        "OFFICIAL_MULTI_YEAR",
      ]),
    ).toThrow(/release-sha/i);
  });

  it("RED-7: authorization consumption is exclusive under concurrent processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red7-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red7-auth",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const workerA = await spawnAuthConsumeWorker(prep.authorizationReceiptPath, "A");
      const workerB = await spawnAuthConsumeWorker(prep.authorizationReceiptPath, "B");
      const results: Array<{ ok: boolean; label: string }> = [];
      await new Promise<void>((resolve) => {
        let count = 0;
        const onResult = () => {
          count += 1;
          if (count >= 2) {
            resolve();
          }
        };
        workerA.on("message", (message: { ok: boolean; label: string }) => {
          results.push(message);
          onResult();
        });
        workerB.on("message", (message: { ok: boolean; label: string }) => {
          results.push(message);
          onResult();
        });
        workerA.send("go");
        workerB.send("go");
      });
      workerA.kill();
      workerB.kill();
      const winners = results.filter((result) => result.ok);
      expect(winners).toHaveLength(1);
      const consumed = JSON.parse(readFileSync(prep.authorizationReceiptPath, "utf8"));
      expect(consumed.consumed).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-8: shared portfolio snapshots use symbol-isolated feature windows", () => {
    const bars = loadOfficialSharedPortfolioBars({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      includeHoldout: false,
    });
    const merged = mergeFhvSharedPortfolioBarsChronologically(bars);
    const snapshots = buildFhvSharedPortfolioSnapshotsForTest(merged);
    expect(snapshots.length).toBeGreaterThan(0);
    for (const snapshot of snapshots) {
      const symbols = new Set(snapshot.bars.map((bar) => bar.symbol));
      expect(symbols.size).toBe(1);
    }
    const firstBtc = snapshots.find((snapshot) => snapshot.bars[0]?.symbol === "BTC/USDT");
    const firstEth = snapshots.find((snapshot) => snapshot.bars[0]?.symbol === "ETH/USDT");
    expect(firstBtc?.bars.every((bar) => bar.symbol === "BTC/USDT")).toBe(true);
    expect(firstEth?.bars.every((bar) => bar.symbol === "ETH/USDT")).toBe(true);
  });

  it("RED-9: historical execution session does not import test-users", async () => {
    const source = readFileSync(
      join(process.cwd(), "lib/trader/observability/fhv-historical-execution-session.ts"),
      "utf8",
    );
    expect(source).not.toContain("@/tests/helpers/test-users");
    expect(source).toContain("fhv-sqlite-research-org-seed");
  });
});

describe("DEE-436 FHV dataset qualification OFFICIAL_MULTI_YEAR negatives", () => {
  it("rejects schema integration fixture under OFFICIAL_MULTI_YEAR coverage rules", () => {
    expect(() =>
      qualifyFhvOfficialDataset({
        datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        qualificationMode: "OFFICIAL_MULTI_YEAR",
      }),
    ).toThrow(/PARTITION_INCOMPLETE|PARTITION_COVERAGE_END_MISMATCH|must close at/i);
  });
});
