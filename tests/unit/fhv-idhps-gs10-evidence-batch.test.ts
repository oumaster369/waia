import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_BATCH_CYCLES,
  resolveEvidenceBatchCycles,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";

describe("H-ARCH-1 GS-10 MAX_BATCH_CYCLES evidence flush contract", () => {
  const prior = process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES;

  afterEach(() => {
    if (prior === undefined) {
      delete process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES;
    } else {
      process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES = prior;
    }
  });

  it("locks MAX_BATCH_CYCLES at 32", () => {
    expect(MAX_BATCH_CYCLES).toBe(32);
    expect(resolveEvidenceBatchCycles()).toBe(32);
  });

  it("ignores FHV_IDHPS_EVIDENCE_BATCH_CYCLES overrides that would enlarge chunks", () => {
    process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES = "512";
    expect(resolveEvidenceBatchCycles()).toBe(MAX_BATCH_CYCLES);
    process.env.FHV_IDHPS_EVIDENCE_BATCH_CYCLES = "1024";
    expect(resolveEvidenceBatchCycles()).toBe(MAX_BATCH_CYCLES);
  });
});
