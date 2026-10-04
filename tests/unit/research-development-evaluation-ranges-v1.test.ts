import { describe, expect, it } from "vitest";
import { resolveFhvCanonicalPartitionInterval } from "@/lib/trader/market-data/fhv-partition-boundaries";
import type { ResearchExperimentSpecV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import { assertResearchDevelopmentEvaluationRangesV1 } from "@/lib/trader/research/research-development-evaluation-ranges-v1";

type Range = {
  firstOpenMs: number;
  lastCloseMs: number;
  barCount: number;
};

const MINUTE_MS = 60_000;
const development = resolveFhvCanonicalPartitionInterval("development");
const developmentStartMs = Date.parse(development.startUtc);
const developmentEndMs = Date.parse(development.endUtc);

function range(firstOpenMs: number, lastCloseMs: number): Range {
  return {
    firstOpenMs,
    lastCloseMs,
    barCount: (lastCloseMs - firstOpenMs) / MINUTE_MS,
  };
}

function spec(
  validation: Range,
  walkForward: Range[],
  interval = "1m",
): ResearchExperimentSpecV1 {
  return {
    universe: { interval },
    partitions: { validation, walkForward },
  } as unknown as ResearchExperimentSpecV1;
}

function expectInvalid(value: ResearchExperimentSpecV1): void {
  expect(() => assertResearchDevelopmentEvaluationRangesV1(value))
    .toThrow("RESEARCH_DEVELOPMENT_EVALUATION_RANGE_INVALID");
}

describe("assertResearchDevelopmentEvaluationRangesV1", () => {
  it("accepts declared 1m validation and ordered windows ending exactly at the development boundary", () => {
    const validation = range(developmentEndMs - 3 * MINUTE_MS, developmentEndMs);
    const value = spec(validation, [
      range(developmentEndMs - 2 * MINUTE_MS, developmentEndMs - MINUTE_MS),
      range(developmentEndMs - MINUTE_MS, developmentEndMs),
    ]);

    expect(() => assertResearchDevelopmentEvaluationRangesV1(value)).not.toThrow();
  });

  it("rejects a non-1m universe and malformed validation counts, duration, timestamps, and alignment", () => {
    const validValidation = range(developmentStartMs, developmentStartMs + 2 * MINUTE_MS);
    const validWindow = range(developmentStartMs, developmentStartMs + MINUTE_MS);
    expectInvalid(spec(validValidation, [validWindow], "5m"));

    expectInvalid(spec({ ...validValidation, barCount: 0 }, [validWindow]));
    expectInvalid(spec({ ...validValidation, barCount: 1.5 }, [validWindow]));
    expectInvalid(spec({ ...validValidation, barCount: 1 }, [validWindow]));
    expectInvalid(spec({ ...validValidation, firstOpenMs: developmentStartMs + 1 }, [validWindow]));
    expectInvalid(spec({ ...validValidation, lastCloseMs: developmentStartMs + 2 * MINUTE_MS + 1 }, [validWindow]));
    expectInvalid(spec({ ...validValidation, firstOpenMs: Number.MAX_SAFE_INTEGER + 1 }, [validWindow]));
    expectInvalid(spec({ ...validValidation, barCount: Math.floor(Number.MAX_SAFE_INTEGER / MINUTE_MS) + 1 }, [validWindow]));
  });

  it("requires the complete validation interval to be inside canonical development", () => {
    const outsideStart = range(developmentStartMs - MINUTE_MS, developmentStartMs + MINUTE_MS);
    const outsideEnd = range(developmentEndMs - MINUTE_MS, developmentEndMs + MINUTE_MS);
    expectInvalid(spec(outsideStart, [range(developmentStartMs, developmentStartMs + MINUTE_MS)]));
    expectInvalid(spec(outsideEnd, [range(developmentEndMs - MINUTE_MS, developmentEndMs)]));
  });

  it("requires nonempty ordered, non-overlapping walk-forward windows contained in validation", () => {
    const validation = range(developmentStartMs, developmentStartMs + 5 * MINUTE_MS);
    expectInvalid(spec(validation, []));
    expectInvalid(spec(validation, [
      range(developmentStartMs, developmentStartMs + 2 * MINUTE_MS),
      range(developmentStartMs + MINUTE_MS, developmentStartMs + 3 * MINUTE_MS),
    ]));
    expectInvalid(spec(validation, [
      range(developmentStartMs + 3 * MINUTE_MS, developmentStartMs + 4 * MINUTE_MS),
      range(developmentStartMs + MINUTE_MS, developmentStartMs + 2 * MINUTE_MS),
    ]));
    expectInvalid(spec(validation, [
      range(developmentStartMs - MINUTE_MS, developmentStartMs + MINUTE_MS),
    ]));
    expectInvalid(spec(validation, [
      range(developmentStartMs + 4 * MINUTE_MS, developmentStartMs + 6 * MINUTE_MS),
    ]));
    expectInvalid(spec(validation, [
      { ...range(developmentStartMs, developmentStartMs + MINUTE_MS), barCount: 2 },
    ]));
  });

  it("does not mutate the declared specification", () => {
    const value = spec(
      range(developmentStartMs, developmentStartMs + 3 * MINUTE_MS),
      [
        range(developmentStartMs, developmentStartMs + MINUTE_MS),
        range(developmentStartMs + 2 * MINUTE_MS, developmentStartMs + 3 * MINUTE_MS),
      ],
    );
    const before = structuredClone(value);

    assertResearchDevelopmentEvaluationRangesV1(value);

    expect(value).toEqual(before);
  });
});
