import fs from "node:fs";
import path from "node:path";

import {
  applyNewBarsToCanvas,
  createInitialCanvasState,
} from "@/lib/trader/backtest/canvas-replay-integration";
import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import { buildHistoricalIngressContext } from "@/lib/trader/market-data/replay/historical-ingress-gateway";
import { parseReplayProviderSidecar } from "@/lib/trader/market-data/replay/provider-sidecar-types";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import type { ReplayProviderSidecar } from "@/lib/trader/market-data/replay/provider-sidecar-types";

export const HTR_WP11_PIT_CONTEXT_DIR = "replay-runs/RI-P7/htr-wp11-pit-provider-context";
export const HTR_WP11_PIT_CONTEXT_COMMAND = "pnpm trader:replay:pit-context";

export type PitContextEvidenceHarness = {
  schemaVersion: "htr-wp11-pit-provider-context/v1";
  evaluatedAt: string;
  instrumentId: string;
  fixturePaths: {
    bars: string;
    sidecarV1: string;
    sidecarV2: string;
  };
  sidecarV1Digest: string;
  sidecarV2Digest: string;
  fusedContextDigest: string;
  degradationReasonCount: number;
  gitSha: string;
  dirtyTree: boolean;
  reproductionCommand: string;
};

function loadFixture<T>(relativePath: string): T {
  const absolutePath = path.join(process.cwd(), relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8")) as T;
}

export function runPitContextEvidenceHarness(): PitContextEvidenceHarness {
  const barsFixture = loadFixture<{ bars: Bar[]; latestQuote: Quote }>(
    "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
  );
  const sidecarV1 = loadFixture<ReplayProviderSidecar>(
    "tests/fixtures/trader/m9-provider-sidecar.json",
  );
  const sidecarV2 = loadFixture<ReplayProviderSidecar>(
    "tests/fixtures/trader/m9-provider-sidecar-v2.json",
  );

  parseReplayProviderSidecar(sidecarV1);
  parseReplayProviderSidecar(sidecarV2);

  const evaluatedAt = barsFixture.bars.at(-1)!.barCloseTime;
  let canvasState = createInitialCanvasState();
  canvasState = applyNewBarsToCanvas(canvasState, barsFixture.bars, 0).state;

  const ingress = buildHistoricalIngressContext({
    substrateMode: "parity-both",
    bars: barsFixture.bars,
    quote: barsFixture.latestQuote,
    evaluatedAt,
    instrumentId: "BTC/USDT",
    providerSidecar: sidecarV2,
    canvasState,
  });

  return {
    schemaVersion: "htr-wp11-pit-provider-context/v1",
    evaluatedAt,
    instrumentId: "BTC/USDT",
    fixturePaths: {
      bars: "tests/fixtures/trader/btcusdt-1m-mean-reversion.json",
      sidecarV1: "tests/fixtures/trader/m9-provider-sidecar.json",
      sidecarV2: "tests/fixtures/trader/m9-provider-sidecar-v2.json",
    },
    sidecarV1Digest: canonicalJsonString(sidecarV1),
    sidecarV2Digest: canonicalJsonString(sidecarV2),
    fusedContextDigest: canonicalJsonString(ingress.context),
    degradationReasonCount: ingress.degradationReasons.length,
    gitSha: readGitCodeSha(),
    dirtyTree: readGitDirtyTree(),
    reproductionCommand: HTR_WP11_PIT_CONTEXT_COMMAND,
  };
}

export function writePitContextEvidence(harness: PitContextEvidenceHarness): { outputDir: string } {
  const outputDir = path.join(process.cwd(), HTR_WP11_PIT_CONTEXT_DIR);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(outputDir, "pit-provider-context-report.json"),
    `${JSON.stringify(harness, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(outputDir, "README.md"),
    `# HTR-WP11 PIT provider context evidence

Reproduction: \`${harness.reproductionCommand}\`

Git SHA: ${harness.gitSha}
Dirty tree: ${harness.dirtyTree}
EvaluatedAt: ${harness.evaluatedAt}
Fused context digest: ${harness.fusedContextDigest}
`,
  );
  return { outputDir };
}
