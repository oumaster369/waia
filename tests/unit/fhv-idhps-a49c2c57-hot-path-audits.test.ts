import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { computeFeatureSnapshot } from "@/lib/trader/intelligence/feature-engine-v0";
import { runEvaluationCycle } from "@/lib/trader/intelligence/evaluation-cycle";
import type { Bar, Quote } from "@/lib/trader/intelligence/types";
import {
  formatDecimal,
  parseDecimal,
  compareDecimal,
  divideDecimal,
  subtractDecimal,
} from "@/lib/trader/risk/numeric";

function loadFixture(): { bars: Bar[]; latestQuote: Quote } {
  const filePath = path.join(process.cwd(), "tests/fixtures/trader/btcusdt-1m-mean-reversion.json");
  return JSON.parse(readFileSync(filePath, "utf8")) as { bars: Bar[]; latestQuote: Quote };
}

function bigintSqrt(value: bigint): bigint {
  if (value < 2n) {
    return value;
  }
  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }
  return x0;
}

/** Former slice/map oracle preserved for exact equivalence proof. */
function computeFeatureSnapshotSliceMapOracle(input: {
  bars: readonly Bar[];
  quote?: Quote;
  evaluatedAt?: string;
  newId: () => string;
}) {
  const bars = input.bars;
  const evaluatedAt = input.evaluatedAt ?? bars[bars.length - 1]!.barCloseTime;
  const window = bars.slice(-20);
  const closes = window.map((bar) => bar.close);
  const close = bars[bars.length - 1]!.close;
  const mean = (() => {
    let sum = 0n;
    for (const value of closes) {
      sum += parseDecimal(value);
    }
    return formatDecimal(sum / BigInt(closes.length));
  })();
  const sma20 = closes.length > 0 ? mean : close;
  const realizedVol20 = (() => {
    if (closes.length < 2) {
      return "0";
    }
    const avgScaled = parseDecimal(sma20);
    let sumSq = 0n;
    for (const value of closes) {
      const diff = parseDecimal(value) - avgScaled;
      sumSq += diff * diff;
    }
    return formatDecimal(bigintSqrt(sumSq / BigInt(closes.length)));
  })();
  const zscoreVsSma20 =
    compareDecimal(realizedVol20, "0") === 0
      ? "0"
      : divideDecimal(subtractDecimal(close, sma20), realizedVol20);
  return { close, sma20, realizedVol20, zscoreVsSma20, selectedCloses: closes };
}

describe("a49c2c57 hot-path audits (hypothesis omit + feature equivalence)", () => {
  it("feature indexed-loop matches former slice/map oracle byte-for-byte on features", () => {
    const fixture = loadFixture();
    const barsCopy = fixture.bars.map((bar) => ({ ...bar }));
    const oracle = computeFeatureSnapshotSliceMapOracle({
      bars: barsCopy,
      quote: fixture.latestQuote,
      evaluatedAt: barsCopy.at(-1)!.barCloseTime,
      newId: () => "oracle",
    });
    const actual = computeFeatureSnapshot({
      bars: barsCopy,
      quote: fixture.latestQuote,
      evaluatedAt: barsCopy.at(-1)!.barCloseTime,
      newId: () => "actual",
    });
    expect(actual.features.close).toBe(oracle.close);
    expect(actual.features.sma20).toBe(oracle.sma20);
    expect(actual.features.realizedVol20).toBe(oracle.realizedVol20);
    expect(actual.features.zscoreVsSma20).toBe(oracle.zscoreVsSma20);
    expect(oracle.selectedCloses).toHaveLength(Math.min(20, barsCopy.length));
    // No input mutation.
    expect(barsCopy).toEqual(fixture.bars.map((bar) => ({ ...bar })));
  });

  it("short-window feature equivalence (<20 bars)", () => {
    const fixture = loadFixture();
    const short = fixture.bars.slice(0, 5);
    const oracle = computeFeatureSnapshotSliceMapOracle({
      bars: short,
      evaluatedAt: short.at(-1)!.barCloseTime,
      newId: () => "o",
    });
    const actual = computeFeatureSnapshot({
      bars: short,
      evaluatedAt: short.at(-1)!.barCloseTime,
      newId: () => "a",
    });
    expect(actual.features.sma20).toBe(oracle.sma20);
    expect(actual.features.realizedVol20).toBe(oracle.realizedVol20);
    expect(actual.features.zscoreVsSma20).toBe(oracle.zscoreVsSma20);
  });

  it("hypothesis omission requires omitIntelligenceArtifacts && fusedContext==null", () => {
    const fixture = loadFixture();
    const bars = fixture.bars;
    // Skip path is MI-core only (STREAM_ONLY official research enables MI via profile).
    const skipped = runEvaluationCycle({
      organizationId: "00000000-0000-4000-8000-00000000eval",
      bars,
      quote: fixture.latestQuote,
      evaluatedAt: bars.at(-1)!.barCloseTime,
      miCoreEnabled: true,
      omitIntelligenceArtifacts: true,
      fusedContext: undefined,
      newId: () => "eval-skip",
    });
    expect(skipped.hypothesisSet?.hypotheses).toHaveLength(0);
    expect(skipped.hypothesisSet?.activeHypothesis).toBeNull();

    const withFusedOffButArtifactsOn = runEvaluationCycle({
      organizationId: "00000000-0000-4000-8000-00000000eval",
      bars,
      quote: fixture.latestQuote,
      evaluatedAt: bars.at(-1)!.barCloseTime,
      miCoreEnabled: true,
      omitIntelligenceArtifacts: false,
      fusedContext: undefined,
      newId: () => "eval-build",
    });
    expect(withFusedOffButArtifactsOn.hypothesisSet?.hypotheses.length).toBeGreaterThan(0);

    // Non-MI path never reaches the skip (and never returns hypothesisSet).
    const nonMi = runEvaluationCycle({
      organizationId: "00000000-0000-4000-8000-00000000eval",
      bars,
      quote: fixture.latestQuote,
      evaluatedAt: bars.at(-1)!.barCloseTime,
      miCoreEnabled: false,
      omitIntelligenceArtifacts: true,
      fusedContext: undefined,
      newId: () => "eval-non-mi",
    });
    expect(nonMi.hypothesisSet).toBeUndefined();
  });

  it("backtest-runner only sets omitIntelligenceArtifacts under STREAM_ONLY + no sinks", () => {
    const source = readFileSync(
      path.join(process.cwd(), "lib/trader/backtest/backtest-runner.ts"),
      "utf8",
    );
    expect(source).toMatch(
      /omitIntelligenceArtifacts:\s*\n\s*retentionMode === "STREAM_ONLY" &&\s*\n\s*input\.intelligenceRecordsSink == null &&\s*\n\s*input\.forecastDecisionSink == null/,
    );
    // No other production call sites.
    const paper = readFileSync(
      path.join(process.cwd(), "lib/trader/paper/paper-cycle-runner.ts"),
      "utf8",
    );
    expect(paper).toContain("omitIntelligenceArtifacts: input.omitIntelligenceArtifacts");
  });

  it("artifact identity recorder binds FINAL_HEAD separately from EXECUTED_SHA on pull_request", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fhv-identity-"));
    try {
      const finalHead = "a49c2c57dfe1d75e80862c995d9f605a24482205";
      const baseSha = "743ae15b906b89a46a23936ccc6144967e816c0a";
      // Push-mode fallback: FINAL_HEAD == EXECUTED_SHA (no PR event).
      execFileSync(
        "bash",
        [path.join(process.cwd(), "scripts/ops/record-fhv-artifact-identity.sh")],
        {
          env: {
            ...process.env,
            FHV_OFFICIAL_SCALE_ARTIFACT_ROOT: dir,
            GITHUB_EVENT_NAME: "push",
            PUSH_BEFORE_SHA: baseSha,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const executed = readFileSync(path.join(dir, "EXECUTED_SHA.txt"), "utf8").trim();
      const recordedFinal = readFileSync(path.join(dir, "FINAL_HEAD.txt"), "utf8").trim();
      expect(executed).toMatch(/^[0-9a-f]{40}$/);
      expect(recordedFinal).toBe(executed);
      const identity = JSON.parse(
        readFileSync(path.join(dir, "artifact-identity.v1.json"), "utf8"),
      ) as { schemaVersion: string; finalHead: string; executedSha: string; baseSha: string };
      expect(identity.schemaVersion).toBe("fhv-artifact-identity/v1");
      expect(identity.baseSha).toBe(baseSha);
      expect(identity.finalHead).toBe(identity.executedSha);

      // pull_request mode with head checkout (no merge parents): FINAL_HEAD from event.
      const dir2 = mkdtempSync(path.join(tmpdir(), "fhv-identity-pr-"));
      try {
        execFileSync(
          "bash",
          [path.join(process.cwd(), "scripts/ops/record-fhv-artifact-identity.sh")],
          {
            env: {
              ...process.env,
              FHV_OFFICIAL_SCALE_ARTIFACT_ROOT: dir2,
              GITHUB_EVENT_NAME: "pull_request",
              PR_HEAD_SHA: executed,
              PR_BASE_SHA: baseSha,
            },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        expect(readFileSync(path.join(dir2, "FINAL_HEAD.txt"), "utf8").trim()).toBe(executed);
        expect(readFileSync(path.join(dir2, "BASE_SHA.txt"), "utf8").trim()).toBe(baseSha);
      } finally {
        rmSync(dir2, { recursive: true, force: true });
      }
      expect(finalHead).toHaveLength(40);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
