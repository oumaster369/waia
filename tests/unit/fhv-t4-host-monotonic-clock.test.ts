import { describe, expect, it, afterEach } from "vitest";

import {
  assertFhvT4HostMonotonicBudget,
  elapsedFhvT4HostMonotonicNs,
  parseFhvT4HostMonotonicSample,
  setFhvT4HostMonotonicReaderForTests,
} from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";
import { fhvT4HostMonotonicSample } from "../helpers/fhv-t4-test-fixtures";

afterEach(() => {
  setFhvT4HostMonotonicReaderForTests(null);
});

describe("fhv-t4 host monotonic clock (DEE-436)", () => {
  it("parses CLOCK_BOOTTIME samples and computes elapsed ns", () => {
    const sample = parseFhvT4HostMonotonicSample(fhvT4HostMonotonicSample("1000"));
    expect(sample.clockSource).toBe("CLOCK_BOOTTIME");
    expect(elapsedFhvT4HostMonotonicNs("1000", "290000000000")).toBe(289999999000n);
  });

  it("rejects completed monotonic before started monotonic", () => {
    expect(() => elapsedFhvT4HostMonotonicNs("5000", "1000")).toThrow(
      /completedMonotonicNs must be >= startedMonotonicNs/,
    );
  });

  it("rejects budget exceeded and boot-id change", () => {
    expect(() =>
      assertFhvT4HostMonotonicBudget({
        hostBootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        expectedBootId: "cccccccccccccccccccccccccccccccc",
        startedMonotonicNs: "1000",
        completedMonotonicNs: "2000",
      }),
    ).toThrow(/boot ID changed/i);

    expect(() =>
      assertFhvT4HostMonotonicBudget({
        hostBootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        expectedBootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        startedMonotonicNs: "0",
        completedMonotonicNs: "301000000000",
        maxBudgetMs: 300_000,
      }),
    ).toThrow(/budget exceeded/i);
  });

  it("proves cross-process reader continuity with same boot id", () => {
    let call = 0;
    setFhvT4HostMonotonicReaderForTests(() => {
      call += 1;
      return fhvT4HostMonotonicSample(call === 1 ? "1000000000" : "1100000000");
    });
    const processA = parseFhvT4HostMonotonicSample(fhvT4HostMonotonicSample("1000000000"));
    const processB = parseFhvT4HostMonotonicSample(fhvT4HostMonotonicSample("1100000000"));
    expect(processA.bootId).toBe(processB.bootId);
    const { elapsedMs } = assertFhvT4HostMonotonicBudget({
      hostBootId: processA.bootId,
      expectedBootId: processB.bootId,
      startedMonotonicNs: processA.monotonicNs,
      completedMonotonicNs: processB.monotonicNs,
    });
    expect(elapsedMs).toBe(100);
  });
});
