import {
  runCanonicalOrdinaryCapitalCycleV2,
  type CanonicalRecurringCycleV2Result,
} from "@/lib/trader/runtime-v2/canonical-recurring-cycle-v2";

export type ShadowCycleStageV2 = "EPISTEMIC" | "ADMISSION" | "FORECAST" | "DECISION" | "RISK";

export type ShadowCycleRecordV2 = Readonly<{
  barKey: string;
  status: CanonicalRecurringCycleV2Result["status"];
  stage: ShadowCycleStageV2 | null;
  reasonCodes: readonly string[];
}>;

export type ShadowCycleStoreV2 = Readonly<{
  get(barKey: string): Promise<ShadowCycleRecordV2 | null>;
  /** First record for a bar wins. A later call never rewrites it. */
  putIfAbsent(record: ShadowCycleRecordV2): Promise<ShadowCycleRecordV2>;
}>;

export function createMemoryShadowCycleStore(): ShadowCycleStoreV2 {
  const records = new Map<string, ShadowCycleRecordV2>();
  return {
    async get(barKey) {
      return records.get(barKey) ?? null;
    },
    async putIfAbsent(record) {
      const existing = records.get(record.barKey);
      if (existing) return existing;
      const frozen = Object.freeze({
        ...record,
        reasonCodes: Object.freeze([...record.reasonCodes]),
      });
      records.set(record.barKey, frozen);
      return frozen;
    },
  };
}

export function shadowBarKeyV2(
  input: Readonly<{
    organizationId: string;
    accountId: string;
    symbol: string;
    pitAnchor: string;
  }>,
): string {
  return [input.organizationId, input.accountId, input.symbol, input.pitAnchor].join("|");
}

type CycleInput = Parameters<typeof runCanonicalOrdinaryCapitalCycleV2>[0];

/** Calls the canonical cycle directly. It does not place orders and does not invent receipts. */
export async function runShadowCanonicalCycleV2(
  store: ShadowCycleStoreV2,
  barKey: string,
  input: CycleInput,
): Promise<ShadowCycleRecordV2> {
  const existing = await store.get(barKey);
  if (existing) return existing;
  const result = await runCanonicalOrdinaryCapitalCycleV2(input);
  const record: ShadowCycleRecordV2 =
    result.status === "NO_TRADE"
      ? { barKey, status: "NO_TRADE", stage: result.stage, reasonCodes: result.reasonCodes }
      : { barKey, status: "EXECUTION_BOUND", stage: null, reasonCodes: [] };
  return store.putIfAbsent(record);
}
