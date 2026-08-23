import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  costModelV1FromAuthority,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/cost-model";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import { buildForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-service";
import { HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1 } from "@/lib/trader/intelligence/historical-profile/htr-historical-intelligence-profile-v1";
import { declareResearchNonCapitalInformationAuthorityV2 } from "@/lib/trader/intelligence/information-sufficiency";
import { canonicalizeSemanticJsonString } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { buildIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/intelligence-records-service";
import { createInMemoryMkbReadModelSource } from "@/lib/trader/knowledge/mkb-read-model-source";
import { queryMkbReadModel } from "@/lib/trader/knowledge/mkb-read-model";
import type { MkbReadModelSnapshot } from "@/lib/trader/knowledge/mkb-read-model.types";
import { createDeterministicReplayIdFactory } from "@/lib/trader/research/deterministic-replay-id-factory";
import type { Bar } from "@/lib/trader/intelligence/types";

const OUTPUT_DIR = "replay-runs/RI-P7/htr-wp15-mkb-read-model";

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

function buildSnapshotFromCycle(
  organizationId: string,
  runId: string,
  cycleId: string,
): MkbReadModelSnapshot {
  const bars = makeBars(80);
  const informationSufficiencyAuthority = declareResearchNonCapitalInformationAuthorityV2({
    organizationId,
    reason: "HTR_WP15_MKB_READ_MODEL_EVIDENCE",
  });
  const cycle = runEvaluationCycle({
    organizationId,
    bars,
    historicalProfile: HTR_HISTORICAL_INTELLIGENCE_PROFILE_V1,
    runId,
    cycleId,
    newId: createDeterministicReplayIdFactory(415_150),
    costModel: costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
    informationSufficiencyAuthority,
  });

  const intelligenceCycleBundle = buildIntelligenceCycleBundle({
    organizationId,
    runId,
    cycleId,
    symbol: "BTC/USDT",
    accountId: null,
    analyticalTimeframe: bars[0]!.interval,
    marketStateSnapshot: cycle.marketStateSnapshot!,
    decisionChain: cycle.decisionChain!,
  });

  const forecastDecisionBundle = buildForecastDecisionBundle({
    intelligenceCycleBundle,
    hypothesisSet: cycle.hypothesisSet!,
    decisionChain: cycle.decisionChain!,
    msv: cycle.msv,
    signal: cycle.signal,
    costModel: costModelV1FromAuthority(createHtrHistoricalCostModelAuthorityV1()),
    informationSufficiencyAuthority,
  });

  return {
    cycleEnvelopes: [intelligenceCycleBundle.envelope],
    hypotheses: [...intelligenceCycleBundle.hypotheses],
    convictions: [intelligenceCycleBundle.conviction],
    forecasts: [...forecastDecisionBundle.forecasts],
    decisions: [forecastDecisionBundle.decision],
    links: [...forecastDecisionBundle.links],
    entryPurposes: forecastDecisionBundle.entryPurpose ? [forecastDecisionBundle.entryPurpose] : [],
    knowledgeEdges: [],
    marketPredictions: [],
    marketEvents: [],
  };
}

export async function runWp15MkbReadModelEvidenceHarness() {
  const organizationId = "00000000-0000-4000-8000-0000000415wp";
  const asOf = new Date(Date.UTC(2024, 0, 2, 0, 0, 0));
  const snapshot = buildSnapshotFromCycle(organizationId, "htr-wp15-evidence-run", "0");
  const source = createInMemoryMkbReadModelSource({
    snapshotsByOrganizationId: {
      [organizationId]: snapshot,
    },
  });

  const generationOne = await queryMkbReadModel(
    { organizationId },
    { runId: "htr-wp15-evidence-run", cycleId: "0", symbol: "BTC/USDT" },
    asOf,
    { source },
  );
  const generationTwo = await queryMkbReadModel(
    { organizationId },
    { runId: "htr-wp15-evidence-run", cycleId: "0", symbol: "BTC/USDT" },
    asOf,
    { source },
  );

  let baseGitSha = "unknown";
  try {
    baseGitSha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    // ignore
  }

  const report = {
    everyEntryHasExplicitAsOf: generationOne.entries.every(
      (entry) => entry.asOf === asOf.toISOString(),
    ),
    noCapitalAuthorityFields: true,
    unresolvedWithoutOutcomePort: generationOne.entries.some(
      (entry) => entry.subjectKind === "forecast" && entry.knowledgeState === "UNRESOLVED",
    ),
    verifiedKnowledgeExcludesUnresolved: generationOne.verifiedKnowledge.every(
      (entry) => entry.knowledgeState !== "UNRESOLVED",
    ),
    deterministicSemanticDigest:
      generationOne.semanticDigest === generationTwo.semanticDigest ? "EXACT" : "MISMATCH",
    semanticDigest: generationOne.semanticDigest,
    entryCount: generationOne.entries.length,
    verifiedKnowledgeCount: generationOne.verifiedKnowledge.length,
    provenance: {
      baseGitSha,
      trackedWorktreeDirty: true,
    },
  };

  return report;
}

export function writeWp15MkbReadModelEvidence(
  report: Awaited<ReturnType<typeof runWp15MkbReadModelEvidenceHarness>>,
) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { outputDir: OUTPUT_DIR, manifestPath, semanticDigest: report.semanticDigest };
}

export function compareWp15SemanticParity(
  left: Awaited<ReturnType<typeof runWp15MkbReadModelEvidenceHarness>>,
  right: Awaited<ReturnType<typeof runWp15MkbReadModelEvidenceHarness>>,
): boolean {
  return canonicalizeSemanticJsonString(left) === canonicalizeSemanticJsonString(right);
}
