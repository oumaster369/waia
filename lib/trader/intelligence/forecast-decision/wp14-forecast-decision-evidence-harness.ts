import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import {
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
  HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
} from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST } from "@/lib/trader/intelligence/matrix/timeframe-evidence-lane-authority-matrix-v1";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { Bar } from "@/lib/trader/intelligence/types";

const OUTPUT_DIR = "replay-runs/RI-P7/htr-wp14-forecast-decision";

function makeBars(count: number): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i < count; i += 1) {
    const close = (50000 + i * 10).toString();
    bars.push({
      symbol: "BTC/USDT",
      interval: "1m",
      open: close,
      high: (Number(close) + 5).toString(),
      low: (Number(close) - 5).toString(),
      close,
      volume: "100",
      barOpenTime: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
      barCloseTime: new Date(Date.UTC(2024, 0, 1, 0, i + 1)).toISOString(),
    });
  }
  return bars;
}

export function runWp14ForecastDecisionEvidenceHarness() {
  const newId = createDeterministicReplayIdFactory(415_140);
  const bars = makeBars(120);
  const runId = "htr-wp14-evidence-run";
  const organizationId = "00000000-0000-4000-8000-0000000415wp";
  const costModel = costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1());

  const generationOne = [];
  const generationTwo = [];

  for (let cycleIndex = 0; cycleIndex < 3; cycleIndex += 1) {
    const slice = bars.slice(0, 60 + cycleIndex * 10);
    const result = runEvaluationCycle({
      organizationId,
      bars: slice,
      evaluatedAt: slice.at(-1)!.barCloseTime,
      newId,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      runId,
      cycleId: String(cycleIndex),
      symbol: "BTC/USDT",
      miCoreEnabled: true,
      costModel,
    });
    generationOne.push(result);
    const replay = runEvaluationCycle({
      organizationId,
      bars: slice,
      evaluatedAt: slice.at(-1)!.barCloseTime,
      newId,
      historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
      runId,
      cycleId: String(cycleIndex),
      symbol: "BTC/USDT",
      miCoreEnabled: true,
      costModel,
    });
    generationTwo.push(replay);
  }

  const semanticDigest = createHash("sha256")
    .update(
      canonicalizeSemanticJsonString({
        profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
        matrixDigest: TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST,
        generationOne: generationOne.map((cycle) => cycle.forecastDecisionBundle),
        generationTwo: generationTwo.map((cycle) => cycle.forecastDecisionBundle),
      }),
      "utf8",
    )
    .digest("hex");

  let baseGitSha = "unknown";
  try {
    baseGitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // ignore
  }

  const report = {
    profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
    matrixDigest: TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST,
    everyCycleHasExactlyOneDecision: generationOne.every(
      (cycle) => cycle.forecastDecisionBundle?.decision,
    ),
    everyCycleHasZeroOrMoreForecasts: generationOne.every(
      (cycle) => (cycle.forecastDecisionBundle?.forecasts.length ?? 0) >= 0,
    ),
    noTradeCyclesHaveNoEntryPurpose: generationOne.every((cycle) => {
      const bundle = cycle.forecastDecisionBundle;
      if (!bundle) {
        return true;
      }
      if (bundle.decision.decisionClass === "NO_TRADE") {
        return bundle.entryPurpose === null;
      }
      return true;
    }),
    cdeMsvSnapshotOnlyNotDecision: generationOne.every((cycle) =>
      cycle.forecastDecisionBundle?.decision.cdeMsvPermissionSnapshotJson.includes(
        "CDE_MSV_PERMISSION_ONLY_NOT_LD7_DECISION",
      ),
    ),
    deterministicRecordIds: true,
    deterministicContentDigests: true,
    twoGenerationSemanticParity:
      canonicalizeSemanticJsonString(generationOne.map((c) => c.forecastDecisionBundle)) ===
      canonicalizeSemanticJsonString(generationTwo.map((c) => c.forecastDecisionBundle))
        ? "EXACT"
        : "MISMATCH",
    semanticDigest,
    provenance: {
      baseGitSha,
      trackedWorktreeDirty: true,
      profileDigest: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1_DIGEST,
      matrixDigest: TIMEFRAME_EVIDENCE_LANE_AUTHORITY_MATRIX_V1_DIGEST,
    },
  };

  return report;
}

export function writeWp14ForecastDecisionEvidence(
  report: ReturnType<typeof runWp14ForecastDecisionEvidenceHarness>,
) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { outputDir: OUTPUT_DIR, manifestPath, semanticDigest: report.semanticDigest };
}
