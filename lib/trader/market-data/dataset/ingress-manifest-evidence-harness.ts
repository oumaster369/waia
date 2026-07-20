import fs from "node:fs";
import path from "node:path";

import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import {
  buildFhvDatasetManifest,
  FHV_DATASET_PARTITIONS_V1,
} from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import {
  evaluateGapPolicy,
  FHV_GAP_POLICY_V1,
} from "@/lib/trader/market-data/dataset/fhv-gap-policy";
import { assertIngestBarsIntegrity } from "@/lib/trader/market-data/ingress/bar-integrity-gate";
import type { Bar } from "@/lib/trader/intelligence/types";

export const HTR_WP12_INGRESS_MANIFEST_DIR = "replay-runs/RI-P7/htr-wp12-ingress-manifest";
export const HTR_WP12_INGRESS_MANIFEST_COMMAND = "pnpm trader:dataset:manifest";

const SYNTHETIC_SOURCE_PROVENANCE = [
  {
    sourceObjectId: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    retrieval: {
      retrievedAtUtc: "2026-01-01T00:00:00.000Z",
      method: "fixture-read",
      uri: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    },
    sourceChecksumSha256: "a".repeat(64),
  },
] as const;

function loadFixtureBars(): Bar[] {
  const absolutePath = path.join(
    process.cwd(),
    "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
  );
  const parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8")) as { bars: Bar[] };
  return parsed.bars;
}

export type IngressManifestEvidenceHarness = {
  schemaVersion: "htr-wp12-ingress-manifest/v1";
  fixturePath: string;
  gapPolicy: typeof FHV_GAP_POLICY_V1;
  gapPolicyResult: ReturnType<typeof evaluateGapPolicy>;
  partitions: typeof FHV_DATASET_PARTITIONS_V1;
  manifest: ReturnType<typeof buildFhvDatasetManifest>;
  gitSha: string;
  dirtyTree: boolean;
  reproductionCommand: string;
};

export function runIngressManifestEvidenceHarness(): IngressManifestEvidenceHarness {
  const bars = loadFixtureBars();
  const integrity = assertIngestBarsIntegrity({
    bars,
    expectedSymbol: "BTC/USDT",
    expectedInterval: "1m",
  });
  if (!integrity.ok) {
    throw new Error(`[htr-wp12-manifest] ingress integrity failed: ${integrity.reason}`);
  }

  const manifest = buildFhvDatasetManifest({
    sourceObjects: [...SYNTHETIC_SOURCE_PROVENANCE],
    bars,
    normalizedContentDigest: integrity.normalizedContentDigest,
    barSetDigest: integrity.barSetDigest,
    integrityResults: integrity.integrityResults,
    gaps: integrity.gaps,
    expectedBarCount: bars.length,
    intervalBoundaries: {
      startUtc: bars[0]!.barOpenTime,
      endUtc: bars.at(-1)!.barCloseTime,
    },
  });

  return {
    schemaVersion: "htr-wp12-ingress-manifest/v1",
    fixturePath: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
    gapPolicy: FHV_GAP_POLICY_V1,
    gapPolicyResult: evaluateGapPolicy(integrity.gaps),
    partitions: FHV_DATASET_PARTITIONS_V1,
    manifest,
    gitSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    reproductionCommand: HTR_WP12_INGRESS_MANIFEST_COMMAND,
  };
}

export function writeIngressManifestEvidence(harness: IngressManifestEvidenceHarness): {
  outputDir: string;
} {
  const outputDir = path.join(process.cwd(), HTR_WP12_INGRESS_MANIFEST_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "fhv-dataset-manifest.json"),
    `${JSON.stringify(harness.manifest, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, "ingress-manifest-report.json"),
    `${JSON.stringify(harness, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, "README.md"),
    `# HTR-WP12 ingress manifest evidence

Reproduction: \`${harness.reproductionCommand}\`

Git SHA: ${harness.gitSha}
Dirty tree: ${harness.dirtyTree}
Manifest digest: ${harness.manifest.manifestSemanticDigest}
Gap policy result: ${harness.gapPolicyResult}
`,
  );
  return { outputDir };
}
