import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  assertShadowJournalOutsideCheckpointTree,
  createFileShadowCycleStore,
} from "@/lib/trader/runtime-v2/shadow-cycle-file-journal-v2";
import {
  runRecordedShadowCanonicalBarsV2,
  runShadowRunnerCliV2,
  type ShadowContextDigestHexV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-runner-v2";
import { createMemoryShadowCycleStore } from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

const DIGEST = "a".repeat(64);
const ORG = "org-shadow";
const ACCOUNT = "account-1";

const digests: ShadowContextDigestHexV2 = {
  runtimeAssessmentDigestHex: DIGEST,
  driftRestrictionDigestHex: DIGEST,
  qualificationTupleDigestHex: DIGEST,
  packageDigestHex: DIGEST,
  informationContractDigestHex: DIGEST,
  informationNeedPlanDigestHex: DIGEST,
  releaseDigestHex: DIGEST,
};

function bar(barCloseTime: string): Bar {
  return {
    symbol: "BTCUSDT",
    interval: "1m",
    open: "64000",
    high: "64000",
    low: "64000",
    close: "64000",
    volume: "1",
    barOpenTime: "2026-09-22T08:59:00.000Z",
    barCloseTime,
  };
}

describe("shadow cycle file journal", () => {
  it("refuses a journal inside the checkpoint tree", () => {
    expect(() => assertShadowJournalOutsideCheckpointTree("/var/waia/checkpoints/shadow")).toThrow(
      "SHADOW_JOURNAL_INSIDE_CHECKPOINT_TREE",
    );
  });

  it("keeps the exact stage and reason codes across a new store instance", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "shadow-journal-"));
    const first = createFileShadowCycleStore(directory);
    const written = await runRecordedShadowCanonicalBarsV2({
      bars: [bar("2026-09-22T09:00:00.000Z"), bar("2026-09-22T09:01:00.000Z")],
      store: first,
      organizationId: ORG,
      accountId: ACCOUNT,
      contextDigests: digests,
    });
    expect(written).toHaveLength(2);
    expect(written[0]?.stage).toBe("EPISTEMIC");
    expect(written[0]?.reasonCodes).toEqual([
      "NAVIGATOR_RECEIPT_MISSING",
      "PREDICTIVE_ADMISSION_NOT_ADMITTED",
    ]);
    expect(written[1]?.reasonCodes).toEqual(written[0]?.reasonCodes);
    expect(written[0]?.barKey).not.toBe(written[1]?.barKey);

    const restarted = createFileShadowCycleStore(directory);
    const again = await restarted.putIfAbsent({
      barKey: written[0]!.barKey,
      status: "NO_TRADE",
      stage: "RISK",
      reasonCodes: ["COLLAPSED"],
    });
    expect(again).toEqual(written[0]);
    const journal = readFileSync(path.join(directory, "shadow-cycle-journal-v2.jsonl"), "utf8");
    expect(journal.trim().split("\n")).toHaveLength(2);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(directory, "shadow-cycle-journal-v2.jsonl")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("does not open a network client from the recorded-bar loop", async () => {
    const source = readFileSync("lib/trader/runtime-v2/shadow-canonical-runner-v2.ts", "utf8");
    expect(source).not.toContain("htx.com");
    expect(source).not.toContain("fetch(");
    const records = await runRecordedShadowCanonicalBarsV2({
      bars: [bar("2026-09-22T09:00:00.000Z")],
      store: createMemoryShadowCycleStore(),
      organizationId: ORG,
      accountId: ACCOUNT,
      contextDigests: digests,
    });
    expect(records[0]?.status).toBe("NO_TRADE");
  });

  it("returns 64 when the runner is missing a required argument", async () => {
    const code = await runShadowRunnerCliV2(["--journal", "/tmp/shadow"], () => {
      throw new Error("STORE_MUST_NOT_OPEN");
    });
    expect(code).toBe(64);
  });
});
