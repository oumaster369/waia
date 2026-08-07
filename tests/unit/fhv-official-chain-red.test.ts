/**
 * DEE-436/DEE-416 — FHV official chain RED-A..RED-L closure proofs.
 *
 * Documents architect RED defects; asserts GREEN state after authority-chain repair.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { EXPAND_MIN_BARS } from "@/lib/trader/market-data/fixture-bar-replay-source";
import {
  createLazyOfficialInterleavedBarIterator,
  FhvLazySharedPortfolioBarReplaySource,
  FhvSharedPortfolioBarReplaySource,
  getFhvSharedPortfolioSnapshotMaterializationCount,
  inspectFhvSharedPortfolioWindowSizesForTest,
  resetFhvSharedPortfolioSnapshotMaterializationCount,
} from "@/lib/trader/market-data/fhv-shared-portfolio-bar-replay-source";
import type { Bar } from "@/lib/trader/intelligence/types";
import { FhvArtifactAuthorityError } from "@/lib/trader/observability/fhv-artifact-authority-chain";
import {
  qualifyFhvOfficialDataset,
  writeFhvDatasetQualificationReceiptAtomic,
} from "@/lib/trader/observability/fhv-dataset-qualification";
import { resolveFhvFullHistoricalTerminalClassification } from "@/lib/trader/observability/fhv-full-historical-launch";
import { resolveFhvAuthorizeFullCliConfig } from "@/scripts/trader/fhv-authorize-full-cli";
import { resolveFhvControlReplayCliConfig } from "@/scripts/trader/fhv-control-replay-cli";
import { resolveFhvFreezeConfigCliConfig } from "@/scripts/trader/fhv-freeze-config-cli";
import {
  FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
  FHV_OFFICIAL_REAL_SCHEMA_ROOT,
  FHV_TEST_ORG_ID,
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
  setupFhvOfficialSchemaLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_A = FHV_TEST_ORG_ID;
const ORG_B = "00000000-0000-4000-8000-000000000999";
const OPERATOR_A = "fhv-official-chain-operator-a";
const OPERATOR_B = "fhv-official-chain-operator-b";
const SHA_A = FHV_TEST_RELEASE_SHA;
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function generateInterleavedBars(barsPerSymbol: number): Bar[] {
  const bars: Bar[] = [];
  const startMs = Date.parse("2020-01-01T00:00:00.000Z");
  for (let index = 0; index < barsPerSymbol; index += 1) {
    for (const [symbol, basePrice] of [
      ["BTC/USDT", "65000.00"],
      ["ETH/USDT", "3500.00"],
    ] as const) {
      const openMs = startMs + index * 120_000 + (symbol.startsWith("BTC") ? 0 : 60_000);
      bars.push({
        symbol,
        interval: "1m",
        open: basePrice,
        high: basePrice,
        low: basePrice,
        close: basePrice,
        volume: "1.00",
        barOpenTime: new Date(openMs).toISOString(),
        barCloseTime: new Date(openMs + 60_000).toISOString(),
      });
    }
  }
  return bars.sort((left, right) => Date.parse(left.barOpenTime) - Date.parse(right.barOpenTime));
}

describe("DEE-436 FHV official chain RED-A..RED-L", () => {
  it("RED-A/GREEN: dataset qualification packet documents --receipt-dir and OFFICIAL_MULTI_YEAR", () => {
    const body = readFileSync(
      join(process.cwd(), "docs/ops/FHV-DATASET-QUALIFICATION-PACKET.md"),
      "utf8",
    );
    expect(body).toContain("--receipt-dir");
    expect(body).toContain("OFFICIAL_MULTI_YEAR");
    expect(body).not.toMatch(/--output[^\n]*fhv-dataset-qualification/);
  });

  it("RED-B/GREEN: control replay packet documents dual-run contract", () => {
    const body = readFileSync(join(process.cwd(), "docs/ops/FHV-CONTROL-REPLAY-PACKET.md"), "utf8");
    expect(body).toContain("--run-one-id");
    expect(body).toContain("--run-two-id");
    expect(body).toContain("--checkout-identity-proof-path-run-one");
    expect(body).toContain("--checkout-identity-proof-path-run-two");
    expect(body).not.toMatch(/--checkout-identity-proof-path[^-\n]/);
  });

  it("RED-C/GREEN: freeze CLI rejects qualification identity substitution", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red-c-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red-c-run",
        organizationId: ORG_A,
        operatorId: OPERATOR_A,
      });
      expect(() =>
        resolveFhvFreezeConfigCliConfig(process.env, [
          "--release-sha",
          SHA_A,
          "--release-tag",
          FHV_TEST_RELEASE_TAG,
          "--run-id",
          "fhv-red-c-run",
          "--organization-id",
          ORG_B,
          "--operator-id",
          OPERATOR_B,
          "--artifact-dir",
          join(root, "freeze-b"),
          "--qualification-receipt-path",
          prep.qualificationReceiptPath,
        ]),
      ).toThrow(FhvArtifactAuthorityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-D/GREEN: authorize-full rejects freeze identity substitution", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red-d-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red-d-run",
        organizationId: ORG_A,
        operatorId: OPERATOR_A,
      });
      expect(() =>
        resolveFhvAuthorizeFullCliConfig(
          {
            ...process.env,
            FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
          },
          [
            "--release-sha",
            SHA_B,
            "--release-tag",
            FHV_TEST_RELEASE_TAG,
            "--run-id",
            "fhv-red-d-run",
            "--organization-id",
            ORG_A,
            "--operator-id",
            OPERATOR_A,
            "--receipt-dir",
            join(root, "auth-b"),
            "--configuration-freeze-path",
            prep.configurationFreezePath,
            "--qualification-receipt-path",
            prep.qualificationReceiptPath,
          ],
        ),
      ).toThrow(FhvArtifactAuthorityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-E/GREEN: authorize-full rejects control replay cross-ceremony rebind", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-red-e-"));
    try {
      const prepA = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red-e-run-a",
        organizationId: ORG_A,
        operatorId: OPERATOR_A,
        releaseSha: SHA_A,
      });
      const prepB = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-red-e-run-b",
        organizationId: ORG_B,
        operatorId: OPERATOR_B,
        releaseSha: SHA_B,
      });
      expect(() =>
        resolveFhvAuthorizeFullCliConfig(
          {
            ...process.env,
            FHV_FULL_HISTORICAL_AUTHORIZATION: "AUTHORIZE-FULL-HISTORICAL-VALIDATION",
          },
          [
            "--release-sha",
            SHA_B,
            "--release-tag",
            FHV_TEST_RELEASE_TAG,
            "--run-id",
            "fhv-red-e-run-b",
            "--organization-id",
            ORG_B,
            "--operator-id",
            OPERATOR_B,
            "--receipt-dir",
            join(root, "auth-cross"),
            "--configuration-freeze-path",
            prepB.configurationFreezePath,
            "--qualification-receipt-path",
            prepB.qualificationReceiptPath,
            "--control-replay-receipt-path",
            prepA.controlReplayReceiptPath,
          ],
        ),
      ).toThrow(FhvArtifactAuthorityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("RED-F/GREEN: schema integration fixture never classifies as official completion", () => {
    const qualified = qualifyFhvOfficialDataset({
      datasetRoot: FHV_OFFICIAL_REAL_SCHEMA_ROOT,
      manifestPath: FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
      qualificationMode: "SCHEMA_INTEGRATION_FIXTURE",
      releaseSha: SHA_A,
      releaseTag: FHV_TEST_RELEASE_TAG,
      organizationId: ORG_A,
      operatorId: OPERATOR_A,
    });
    expect(qualified.qualificationMode).toBe("SCHEMA_INTEGRATION_FIXTURE");
    expect(
      resolveFhvFullHistoricalTerminalClassification({
        boundedFixture: false,
        qualificationReceipt: {
          ...qualified,
          qualificationReceiptDigest: "a".repeat(64),
          qualifiedAtUtc: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).toBe("FHV_SCHEMA_INTEGRATION_CEREMONY_PASS");
  });

  it("RED-G/GREEN: post-warm-up windows remain EXPAND_MIN_BARS wide", () => {
    const bars = generateInterleavedBars(EXPAND_MIN_BARS + 120);
    const sizes = inspectFhvSharedPortfolioWindowSizesForTest(bars, 240);
    expect(sizes.get("BTC/USDT")).toBe(EXPAND_MIN_BARS);
    expect(sizes.get("ETH/USDT")).toBe(EXPAND_MIN_BARS);
  });

  it("RED-H/GREEN: constructor does not eagerly materialize snapshots", () => {
    resetFhvSharedPortfolioSnapshotMaterializationCount();
    const bars = generateInterleavedBars(EXPAND_MIN_BARS + 5);
    new FhvSharedPortfolioBarReplaySource(bars);
    expect(getFhvSharedPortfolioSnapshotMaterializationCount()).toBe(0);
  });

  it("RED-I/GREEN: qualification source does not retain allBars corpus", () => {
    const source = readFileSync(
      join(process.cwd(), "lib/trader/observability/fhv-dataset-qualification.ts"),
      "utf8",
    );
    expect(source).not.toContain("allBars");
    expect(source).not.toContain("symbolBars");
  });

  it("RED-J/GREEN: dedicated BTC/ETH execution evidence test exists", () => {
    expect(
      readFileSync(
        join(process.cwd(), "tests/unit/fhv-btc-eth-execution-evidence.test.ts"),
        "utf8",
      ),
    ).toContain("FHV_BTC_ETH_REAL_EXECUTION_AND_ECONOMIC_EVIDENCE_PASS");
  });

  it("RED-K/GREEN: public ceremony shell test uses production checkout command", () => {
    const source = readFileSync(
      join(process.cwd(), "tests/integration/fhv-public-ceremony-shell.test.ts"),
      "utf8",
    );
    expect(source).not.toContain("writeFhvTestCheckoutIdentityProof");
    expect(source).not.toContain("FHV_CHECKOUT_IDENTITY_TEST_BYPASS");
    expect(source).toContain("record-checkout-identity");
  });

  it("RED-L/GREEN: official control replay requires second-run artifacts", () => {
    expect(() =>
      resolveFhvControlReplayCliConfig(process.env, [
        "--release-sha",
        SHA_A,
        "--release-tag",
        FHV_TEST_RELEASE_TAG,
        "--organization-id",
        ORG_A,
        "--operator-id",
        OPERATOR_A,
        "--run-one-id",
        "fhv-red-l-one",
        "--run-two-id",
        "fhv-red-l-two",
        "--artifact-root",
        "/tmp/fhv-red-l",
        "--configuration-freeze-path",
        "/tmp/freeze-one.json",
        "--authorization-receipt-path",
        "/tmp/auth-one.json",
        "--dataset-qualification-receipt-path",
        "/tmp/qualify.json",
        "--dataset-root",
        FHV_OFFICIAL_REAL_SCHEMA_ROOT,
        "--manifest-path",
        FHV_OFFICIAL_REAL_SCHEMA_MANIFEST,
        "--checkout-identity-proof-path-run-one",
        "/tmp/checkout-one.json",
        "--checkout-identity-proof-path-run-two",
        "/tmp/checkout-two.json",
        "--control-replay-receipt-output",
        "/tmp/control-replay.json",
      ]),
    ).toThrow(/configuration-freeze-path-run-two|authorization-receipt-path-run-two/i);
  });
});
