import { readFileSync } from "node:fs";

import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION } from "@/lib/trader/intelligence/forecast-v2/forecast-runtime-authority-v2";
import type { Bar } from "@/lib/trader/intelligence/types";
import { buildAuthoritativeRuntimeContextV2 } from "@/lib/trader/runtime-v2/authoritative-runtime-context-v2";
import type { DecisionCapitalRequestV2 } from "@/lib/trader/runtime-v2/decision-capital-authority-v2";
import {
  runShadowCanonicalCycleV2,
  shadowBarKeyV2,
  type ShadowCycleRecordV2,
  type ShadowCycleStoreV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

export type ShadowContextDigestHexV2 = Readonly<{
  runtimeAssessmentDigestHex: string;
  driftRestrictionDigestHex: string;
  qualificationTupleDigestHex: string;
  packageDigestHex: string;
  informationContractDigestHex: string;
  informationNeedPlanDigestHex: string;
  releaseDigestHex: string;
}>;

export type ClosedBarSourceV2 = Readonly<{
  nextClosedBar(): Promise<Bar | null>;
}>;

const refusalDeps = {
  decide: async () => {
    throw new Error("SHADOW_EXECUTION_FORBIDDEN");
  },
  assessRisk: async () => {
    throw new Error("SHADOW_EXECUTION_FORBIDDEN");
  },
  execute: async () => {
    throw new Error("SHADOW_EXECUTION_FORBIDDEN");
  },
};

function nonActionableForecast(): DecisionCapitalRequestV2["forecastOutcome"] {
  const body = {
    schemaVersion: FORECAST_RUNTIME_NON_ACTIONABLE_V2_VERSION,
    status: "NON_ACTIONABLE" as const,
    capitalAuthority: "NONE" as const,
    reason: "MISSING_OR_NOT_ADMITTED" as const,
    predictiveAdmissionReceiptContentDigestHex: null,
    marketStateSnapshotContentDigestHex: null,
    selectedPredictivePackageContentDigestHex: null,
    upstreamReasonCodes: [] as string[],
  };
  return { ...body, contentDigestHex: computeSemanticSha256Hex(body) };
}

function recordedBarSource(bars: readonly Bar[]): ClosedBarSourceV2 {
  let index = 0;
  return {
    async nextClosedBar() {
      const bar = bars[index];
      index += 1;
      return bar ?? null;
    },
  };
}

/**
 * One pass over already-closed bars. Qualification stays NOT_ADMITTED.
 * The bar source is injected: tests pass recorded bars and this function does not open a socket.
 */
export async function runShadowCanonicalBarCloseLoopV2(input: {
  source: ClosedBarSourceV2;
  store: ShadowCycleStoreV2;
  organizationId: string;
  accountId: string;
  contextDigests: ShadowContextDigestHexV2;
  maxBars?: number;
}): Promise<readonly ShadowCycleRecordV2[]> {
  const records: ShadowCycleRecordV2[] = [];
  const limit = input.maxBars ?? Number.POSITIVE_INFINITY;
  while (records.length < limit) {
    const bar = await input.source.nextClosedBar();
    if (!bar) break;
    if (!bar.barCloseTime) throw new Error("SHADOW_BAR_NOT_CLOSED");
    const context = buildAuthoritativeRuntimeContextV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      symbol: bar.symbol,
      pitAnchor: bar.barCloseTime,
      runtimePosture: "FULL_ANALYSIS_AND_NEW_RISK",
      driftPosture: "NORMAL",
      ...input.contextDigests,
    });
    const barKey = shadowBarKeyV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      symbol: bar.symbol,
      pitAnchor: bar.barCloseTime,
    });
    records.push(
      await runShadowCanonicalCycleV2(input.store, barKey, {
        epistemic: {
          context,
          navigatorReceipt: null,
          predictiveAdmissionVerdict: "NOT_ADMITTED",
          futureCycleEffect: null,
        },
        admissionTemplate: {} as never,
        capitalDeps: refusalDeps,
        capitalRequest: {
          organizationId: input.organizationId,
          accountId: input.accountId,
          cycleId: barKey,
          symbol: bar.symbol,
          referencePrice: bar.close,
          executionMode: "paper",
          forecastOutcome: nonActionableForecast(),
          proposal: { action: "ENTER_LONG", quantity: "1", strategySignalId: null },
        },
      }),
    );
  }
  return records;
}

export async function runRecordedShadowCanonicalBarsV2(input: {
  bars: readonly Bar[];
  store: ShadowCycleStoreV2;
  organizationId: string;
  accountId: string;
  contextDigests: ShadowContextDigestHexV2;
}): Promise<readonly ShadowCycleRecordV2[]> {
  return runShadowCanonicalBarCloseLoopV2({
    ...input,
    source: recordedBarSource(input.bars),
  });
}

function readDigests(path: string): ShadowContextDigestHexV2 {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("SHADOW_DIGESTS_INVALID");
  const digests = parsed as Partial<ShadowContextDigestHexV2>;
  const keys: (keyof ShadowContextDigestHexV2)[] = [
    "runtimeAssessmentDigestHex",
    "driftRestrictionDigestHex",
    "qualificationTupleDigestHex",
    "packageDigestHex",
    "informationContractDigestHex",
    "informationNeedPlanDigestHex",
    "releaseDigestHex",
  ];
  for (const key of keys) {
    if (typeof digests[key] !== "string") throw new Error("SHADOW_DIGESTS_INVALID");
  }
  return digests as ShadowContextDigestHexV2;
}

/** Exit 64 unless every required flag is present. Does not contact HTX. */
export async function runShadowRunnerCliV2(
  args: readonly string[],
  storeForDirectory: (directory: string) => ShadowCycleStoreV2,
): Promise<number> {
  if (
    args.length !== 10 ||
    args[0] !== "--journal" ||
    args[2] !== "--bars" ||
    args[4] !== "--digests" ||
    args[6] !== "--organization" ||
    args[8] !== "--account"
  ) {
    return 64;
  }
  const journalDirectory = args[1];
  const barsPath = args[3];
  const digestsPath = args[5];
  const organizationId = args[7];
  const accountId = args[9];
  if (!journalDirectory || !barsPath || !digestsPath || !organizationId || !accountId) return 64;
  const bars = JSON.parse(readFileSync(barsPath, "utf8")) as Bar[];
  await runRecordedShadowCanonicalBarsV2({
    bars,
    store: storeForDirectory(journalDirectory),
    organizationId,
    accountId,
    contextDigests: readDigests(digestsPath),
  });
  return 0;
}
