import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const readCount = vi.hoisted(() => ({ n: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      readCount.n += 1;
      return actual.readFileSync(...args);
    },
  };
});

import type { Bar } from "@/lib/trader/intelligence/types";
import {
  assertShadowJournalOutsideCheckpointTree,
  createFileShadowCycleStore,
  SHADOW_JOURNAL_CHECKPOINT_ROOT_ENV,
} from "@/lib/trader/runtime-v2/shadow-cycle-file-journal-v2";
import {
  runRecordedShadowCanonicalBarsV2,
  runShadowCanonicalBarCloseLoopV2,
  runShadowRunnerCliV2,
  type ShadowLiveBarTransportV2,
} from "@/lib/trader/runtime-v2/shadow-canonical-runner-v2";
import { createMemoryShadowCycleStore } from "@/lib/trader/runtime-v2/shadow-canonical-cycle-v2";

const ORG = "org-shadow";
const ACCOUNT = "account-1";

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
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses a producer directory that holds .seal-key and has no checkpoint segment", () => {
    const root = mkdtempSync(path.join(tmpdir(), "shadow-seal-"));
    const producer = path.join(root, "producer-abc123");
    mkdirSync(producer);
    writeFileSync(path.join(producer, ".seal-key"), "");
    try {
      expect(() =>
        assertShadowJournalOutsideCheckpointTree(path.join(producer, "journal")),
      ).toThrow("SHADOW_JOURNAL_SEAL_KEY_ANCESTOR");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses a journal inside WAIA_FHV_CHECKPOINT_ROOT even when the path says producer", () => {
    const checkpointRoot = mkdtempSync(path.join(tmpdir(), "shadow-root-"));
    vi.stubEnv(SHADOW_JOURNAL_CHECKPOINT_ROOT_ENV, checkpointRoot);
    expect(() =>
      assertShadowJournalOutsideCheckpointTree(
        path.join(checkpointRoot, "producer-deadbeef", "journal"),
      ),
    ).toThrow("SHADOW_JOURNAL_INSIDE_CHECKPOINT_ROOT");
    rmSync(checkpointRoot, { recursive: true, force: true });
  });

  it("appends without rereading the journal for every bar", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "shadow-journal-"));
    const readsBefore = readCount.n;
    const store = createFileShadowCycleStore(directory);
    const bars = Array.from({ length: 1000 }, (_, index) =>
      bar(new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()),
    );
    const written = await runRecordedShadowCanonicalBarsV2({
      bars,
      store,
      organizationId: ORG,
      accountId: ACCOUNT,
    });
    expect(written).toHaveLength(1000);
    expect(readCount.n - readsBefore).toBeLessThanOrEqual(1);
    expect(written[0]?.status).toBe("NO_TRADE");
    expect(written[0]?.stage).toBe("EPISTEMIC");
    expect(written[0]?.reasonCodes).toContain("PREDICTIVE_ADMISSION_NOT_ADMITTED");
    expect(written[0]?.reasonCodes).toContain("UNAVAILABLE:runtimeAssessment");
    expect(written[999]?.reasonCodes).toEqual(written[0]?.reasonCodes);
    expect(written[0]?.barKey).not.toBe(written[999]?.barKey);
    const journal = readFileSync(path.join(directory, "shadow-cycle-journal-v2.jsonl"), "utf8");
    expect(journal.trim().split("\n")).toHaveLength(1000);

    const restarted = createFileShadowCycleStore(directory);
    const again = await restarted.putIfAbsent({
      barKey: written[0]!.barKey,
      status: "NO_TRADE",
      stage: "RISK",
      reasonCodes: ["COLLAPSED"],
    });
    expect(again).toEqual(written[0]);
    expect(
      readFileSync(path.join(directory, "shadow-cycle-journal-v2.jsonl"), "utf8")
        .trim()
        .split("\n"),
    ).toHaveLength(1000);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(directory, "shadow-cycle-journal-v2.jsonl")).mode & 0o777).toBe(
      0o600,
    );
    rmSync(directory, { recursive: true, force: true });
  });

  it("does not call an injected live bar transport", async () => {
    const transport: ShadowLiveBarTransportV2 = {
      fetchBars: vi.fn(async () => {
        throw new Error("HTX_NETWORK_FORBIDDEN");
      }),
    };
    const records = await runShadowCanonicalBarCloseLoopV2({
      source: {
        async nextClosedBar() {
          return bar("2026-09-22T09:00:00.000Z");
        },
      },
      store: createMemoryShadowCycleStore(),
      organizationId: ORG,
      accountId: ACCOUNT,
      maxBars: 1,
      liveTransport: transport,
    });
    expect(transport.fetchBars).not.toHaveBeenCalled();
    expect(records[0]?.status).toBe("NO_TRADE");
    expect(records[0]?.stage).toBe("EPISTEMIC");
  });

  it("returns 64 when the runner is missing a required argument", async () => {
    const code = await runShadowRunnerCliV2(["--journal", "/tmp/shadow"], () => {
      throw new Error("STORE_MUST_NOT_OPEN");
    });
    expect(code).toBe(64);
  });
});
