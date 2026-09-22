import { readFileSync } from "node:fs";

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  runShadowCanonicalCycleV2,
  shadowBarKeyV2,
  type ShadowCycleRecordV2,
  type ShadowCycleStoreV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

/** Sources that do not exist before qualification. No digest is supplied for them. */
export const SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES = [
  "runtimeAssessment",
  "driftRestriction",
  "qualificationTuple",
  "package",
  "informationContract",
  "informationNeedPlan",
  "release",
] as const;

export const SHADOW_PRE_QUALIFICATION_ADMISSION = "NOT_ADMITTED" as const;

export type ClosedBarSourceV2 = Readonly<{
  nextClosedBar(): Promise<Bar | null>;
}>;

export type ShadowLiveBarTransportV2 = Readonly<{
  fetchBars(): Promise<readonly Bar[]>;
}>;

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
 * One pass over an injected closed-bar source.
 * There is no live HTX wait. Every bar takes the unavailable-context path.
 */
export async function runShadowCanonicalBarCloseLoopV2(input: {
  source: ClosedBarSourceV2;
  store: ShadowCycleStoreV2;
  organizationId: string;
  accountId: string;
  maxBars?: number;
  liveTransport?: ShadowLiveBarTransportV2;
}): Promise<readonly ShadowCycleRecordV2[]> {
  const records: ShadowCycleRecordV2[] = [];
  const limit = input.maxBars ?? Number.POSITIVE_INFINITY;
  while (records.length < limit) {
    const bar = await input.source.nextClosedBar();
    if (!bar) break;
    if (!bar.barCloseTime) throw new Error("SHADOW_BAR_NOT_CLOSED");
    const barKey = shadowBarKeyV2({
      organizationId: input.organizationId,
      accountId: input.accountId,
      symbol: bar.symbol,
      pitAnchor: bar.barCloseTime,
    });
    records.push(
      await runShadowCanonicalCycleV2(input.store, barKey, {
        epistemic: {
          kind: "CONTEXT_UNAVAILABLE",
          sources: SHADOW_PRE_QUALIFICATION_UNAVAILABLE_SOURCES,
          predictiveAdmissionVerdict: SHADOW_PRE_QUALIFICATION_ADMISSION,
        },
        capitalRequest: { executionMode: "paper" },
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
}): Promise<readonly ShadowCycleRecordV2[]> {
  return runShadowCanonicalBarCloseLoopV2({
    source: recordedBarSource(input.bars),
    store: input.store,
    organizationId: input.organizationId,
    accountId: input.accountId,
  });
}

/** Exit 64 unless --journal, --bars, --organization, and --account are present. */
export async function runShadowRunnerCliV2(
  args: readonly string[],
  storeForDirectory: (directory: string) => ShadowCycleStoreV2,
): Promise<number> {
  if (
    args.length !== 8 ||
    args[0] !== "--journal" ||
    args[2] !== "--bars" ||
    args[4] !== "--organization" ||
    args[6] !== "--account"
  ) {
    return 64;
  }
  const journalDirectory = args[1];
  const barsPath = args[3];
  const organizationId = args[5];
  const accountId = args[7];
  if (!journalDirectory || !barsPath || !organizationId || !accountId) return 64;
  const bars = JSON.parse(readFileSync(barsPath, "utf8")) as Bar[];
  await runRecordedShadowCanonicalBarsV2({
    bars,
    store: storeForDirectory(journalDirectory),
    organizationId,
    accountId,
  });
  return 0;
}
