import { createHash } from "node:crypto";
import { closeSync, openSync, readSync } from "node:fs";

import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  fhvBarsV2RecordToBar,
  parseFhvBarsV2Line,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import {
  createStreamingBarSemanticHasher,
  finalizeStreamingBarSemanticDigest,
  updateStreamingBarSemanticHasher,
} from "@/lib/trader/market-data/fhv-streaming-bar-digest";
import { FHV_SCIENTIFIC_PARTITIONS_V1 } from "@/lib/trader/observability/fhv-partition-receipt";
import type { Bar } from "@/lib/trader/intelligence/types";
import { FHV_DATASET_PARTITIONS_V1 } from "@/lib/trader/market-data/dataset/fhv-dataset-manifest";
import type { FhvOfficialSymbolCode } from "@/lib/trader/market-data/fhv-partition-boundaries";
import { FHV_SYMBOL_CODE_TO_INSTRUMENT } from "@/lib/trader/market-data/fhv-partition-boundaries";

const ONE_MINUTE_MS = 60_000;

export class FhvCanonicalCoverageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvCanonicalCoverageError";
  }
}

export function expectedOneMinuteBarCount(startUtc: string, endUtc: string): number {
  const start = Date.parse(startUtc);
  const end = Date.parse(endUtc);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new FhvCanonicalCoverageError(
      "INTERVAL_INVALID",
      `invalid half-open interval [${startUtc}, ${endUtc})`,
    );
  }
  const delta = end - start;
  if (delta % ONE_MINUTE_MS !== 0) {
    throw new FhvCanonicalCoverageError(
      "INTERVAL_NOT_MINUTE_ALIGNED",
      `interval is not an exact 1-minute multiple [${startUtc}, ${endUtc})`,
    );
  }
  return delta / ONE_MINUTE_MS;
}

export const FHV_CANONICAL_ONE_MINUTE_BAR_COUNTS = {
  DEVELOPMENT: expectedOneMinuteBarCount(
    FHV_SCIENTIFIC_PARTITIONS_V1.DEVELOPMENT.startUtc,
    FHV_SCIENTIFIC_PARTITIONS_V1.DEVELOPMENT.endUtc,
  ),
  WF_PREDICTIVE: expectedOneMinuteBarCount(
    FHV_SCIENTIFIC_PARTITIONS_V1.WF_PREDICTIVE.startUtc,
    FHV_SCIENTIFIC_PARTITIONS_V1.WF_PREDICTIVE.endUtc,
  ),
  WF_ECONOMIC: expectedOneMinuteBarCount(
    FHV_SCIENTIFIC_PARTITIONS_V1.WF_ECONOMIC.startUtc,
    FHV_SCIENTIFIC_PARTITIONS_V1.WF_ECONOMIC.endUtc,
  ),
  WALK_FORWARD_UNION: expectedOneMinuteBarCount(
    FHV_DATASET_PARTITIONS_V1.walkForward.startUtc,
    FHV_DATASET_PARTITIONS_V1.walkForward.endUtc,
  ),
} as const;

export type FhvCoverageProofV1 = Readonly<{
  expectedStartUtc: string;
  expectedEndUtc: string;
  expectedSymbol: "BTC/USDT" | "ETH/USDT";
  interval: "1m";
  firstBarOpen: string;
  lastBarClose: string;
  barCount: number;
  expectedBarCount: number;
  rawSha256: string | null;
  semanticContentDigest: string;
  gapDuplicateIntegrity: "PASS";
}>;

function fail(code: string, message: string): never {
  throw new FhvCanonicalCoverageError(code, message);
}

function processBarForWindow(input: {
  bar: Bar;
  expectedSymbol: "BTC/USDT" | "ETH/USDT";
  expectedStartUtc: string;
  expectedEndUtc: string;
  windowStartMs: number;
  windowEndMs: number;
  lastOpenMs: number | null;
  firstBarOpen: string;
  lastBarClose: string;
  barCount: number;
  hasher: ReturnType<typeof createStreamingBarSemanticHasher>;
}): {
  lastOpenMs: number | null;
  firstBarOpen: string;
  lastBarClose: string;
  barCount: number;
} {
  if (input.bar.symbol !== input.expectedSymbol) {
    fail("SYMBOL_MISMATCH", `expected ${input.expectedSymbol}, got ${input.bar.symbol}`);
  }
  if (input.bar.interval !== "1m") {
    fail("INTERVAL_MISMATCH", `expected 1m, got ${input.bar.interval}`);
  }
  const openMs = Date.parse(input.bar.barOpenTime);
  const closeMs = Date.parse(input.bar.barCloseTime);
  if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) {
    fail("TIMESTAMP_INVALID", `non-finite timestamp at ${input.bar.barOpenTime}`);
  }
  if (closeMs !== openMs + ONE_MINUTE_MS) {
    fail("UTC_OPEN_CLOSE", `bar close must be open+60s at ${input.bar.barOpenTime}`);
  }
  if (openMs < input.windowStartMs || openMs >= input.windowEndMs) {
    return {
      lastOpenMs: input.lastOpenMs,
      firstBarOpen: input.firstBarOpen,
      lastBarClose: input.lastBarClose,
      barCount: input.barCount,
    };
  }
  if (input.barCount === 0) {
    if (input.bar.barOpenTime !== input.expectedStartUtc) {
      fail(
        "START_MISMATCH",
        `first bar open ${input.bar.barOpenTime} != ${input.expectedStartUtc}`,
      );
    }
  } else if (input.lastOpenMs != null) {
    const delta = openMs - input.lastOpenMs;
    if (delta === 0) {
      fail("DUPLICATE", `duplicate timestamp ${input.bar.barOpenTime}`);
    }
    if (delta < 0) {
      fail("UNORDERED", `bar ${input.bar.barOpenTime} is not chronological`);
    }
    if (delta !== ONE_MINUTE_MS) {
      fail("INTERNAL_GAP", `missing minute before ${input.bar.barOpenTime} (deltaMs=${delta})`);
    }
  }
  updateStreamingBarSemanticHasher(input.hasher, input.bar);
  return {
    lastOpenMs: openMs,
    firstBarOpen: input.barCount === 0 ? input.bar.barOpenTime : input.firstBarOpen,
    lastBarClose: input.bar.barCloseTime,
    barCount: input.barCount + 1,
  };
}

/**
 * Prove exact 1m coverage of [expectedStartUtc, expectedEndUtc) from NDJSON bytes.
 * Bounded-memory streaming. Optional raw SHA of the whole file when hashWholeFile is true.
 */
export function proveFhvNdjsonIntervalCoverage(input: {
  filePath: string;
  expectedStartUtc: string;
  expectedEndUtc: string;
  expectedSymbol: "BTC/USDT" | "ETH/USDT";
  hashWholeFile?: boolean;
}): FhvCoverageProofV1 {
  assertPathDoesNotAccessBlindHoldoutPayload(input.filePath);
  const expectedBarCount = expectedOneMinuteBarCount(input.expectedStartUtc, input.expectedEndUtc);
  const windowStartMs = Date.parse(input.expectedStartUtc);
  const windowEndMs = Date.parse(input.expectedEndUtc);
  const hasher = createStreamingBarSemanticHasher();
  const rawHasher = input.hashWholeFile === false ? null : createHash("sha256");
  const fd = openSync(input.filePath, "r");
  let remainder = "";
  const buffer = Buffer.alloc(65_536);
  let barCount = 0;
  let firstBarOpen = "";
  let lastBarClose = "";
  let lastOpenMs: number | null = null;
  let lineNumber = 0;
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        rawHasher?.update(buffer.subarray(0, bytesRead));
        remainder += buffer.subarray(0, bytesRead).toString("utf8");
      }
      const parts = remainder.split("\n");
      remainder = bytesRead > 0 ? (parts.pop() ?? "") : "";
      const lines = bytesRead > 0 ? parts : [...parts, remainder].filter((line) => line.length > 0);
      if (bytesRead <= 0 && remainder.length > 0) {
        lines.push(remainder);
        remainder = "";
      }
      for (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        lineNumber += 1;
        const bar = fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, lineNumber));
        const next = processBarForWindow({
          bar,
          expectedSymbol: input.expectedSymbol,
          expectedStartUtc: input.expectedStartUtc,
          expectedEndUtc: input.expectedEndUtc,
          windowStartMs,
          windowEndMs,
          lastOpenMs,
          firstBarOpen,
          lastBarClose,
          barCount,
          hasher,
        });
        lastOpenMs = next.lastOpenMs;
        firstBarOpen = next.firstBarOpen;
        lastBarClose = next.lastBarClose;
        barCount = next.barCount;
      }
      if (bytesRead <= 0) {
        break;
      }
    }
  } finally {
    closeSync(fd);
  }
  if (barCount === 0) {
    fail("START_MISMATCH", `no bars in [${input.expectedStartUtc}, ${input.expectedEndUtc})`);
  }
  if (firstBarOpen !== input.expectedStartUtc) {
    fail("START_MISMATCH", `first bar open ${firstBarOpen} != ${input.expectedStartUtc}`);
  }
  if (lastBarClose !== input.expectedEndUtc) {
    fail("END_MISMATCH", `last bar close ${lastBarClose} != ${input.expectedEndUtc}`);
  }
  if (barCount !== expectedBarCount) {
    fail(
      "EXACT_COUNT_MISMATCH",
      `bar count ${barCount} != expected ${expectedBarCount} for [${input.expectedStartUtc}, ${input.expectedEndUtc})`,
    );
  }
  return {
    expectedStartUtc: input.expectedStartUtc,
    expectedEndUtc: input.expectedEndUtc,
    expectedSymbol: input.expectedSymbol,
    interval: "1m",
    firstBarOpen,
    lastBarClose,
    barCount,
    expectedBarCount,
    rawSha256: rawHasher ? rawHasher.digest("hex") : null,
    semanticContentDigest: finalizeStreamingBarSemanticDigest(hasher),
    gapDuplicateIntegrity: "PASS",
  };
}

export type FhvWalkForwardScientificSplitProofV1 = Readonly<{
  union: FhvCoverageProofV1;
  wfPredictive: FhvCoverageProofV1;
  wfEconomic: FhvCoverageProofV1;
}>;

/** Independent WF_PREDICTIVE and WF_ECONOMIC proofs from one union file. */
export function proveFhvWalkForwardScientificSplit(input: {
  filePath: string;
  expectedSymbol: "BTC/USDT" | "ETH/USDT";
}): FhvWalkForwardScientificSplitProofV1 {
  const union = proveFhvNdjsonIntervalCoverage({
    filePath: input.filePath,
    expectedStartUtc: FHV_DATASET_PARTITIONS_V1.walkForward.startUtc,
    expectedEndUtc: FHV_DATASET_PARTITIONS_V1.walkForward.endUtc,
    expectedSymbol: input.expectedSymbol,
  });
  const wfPredictive = proveFhvNdjsonIntervalCoverage({
    filePath: input.filePath,
    expectedStartUtc: FHV_SCIENTIFIC_PARTITIONS_V1.WF_PREDICTIVE.startUtc,
    expectedEndUtc: FHV_SCIENTIFIC_PARTITIONS_V1.WF_PREDICTIVE.endUtc,
    expectedSymbol: input.expectedSymbol,
    hashWholeFile: false,
  });
  const wfEconomic = proveFhvNdjsonIntervalCoverage({
    filePath: input.filePath,
    expectedStartUtc: FHV_SCIENTIFIC_PARTITIONS_V1.WF_ECONOMIC.startUtc,
    expectedEndUtc: FHV_SCIENTIFIC_PARTITIONS_V1.WF_ECONOMIC.endUtc,
    expectedSymbol: input.expectedSymbol,
    hashWholeFile: false,
  });
  if (wfPredictive.semanticContentDigest === wfEconomic.semanticContentDigest) {
    fail(
      "SCIENTIFIC_SUBPARTITION_COLLAPSE",
      "WF_PREDICTIVE and WF_ECONOMIC semantic digests must be independent",
    );
  }
  return { union, wfPredictive, wfEconomic };
}

export function proveFhvDevelopmentCoverage(input: {
  filePath: string;
  expectedSymbol: "BTC/USDT" | "ETH/USDT";
}): FhvCoverageProofV1 {
  return proveFhvNdjsonIntervalCoverage({
    filePath: input.filePath,
    expectedStartUtc: FHV_SCIENTIFIC_PARTITIONS_V1.DEVELOPMENT.startUtc,
    expectedEndUtc: FHV_SCIENTIFIC_PARTITIONS_V1.DEVELOPMENT.endUtc,
    expectedSymbol: input.expectedSymbol,
  });
}

export function officialSymbolToInstrument(symbol: FhvOfficialSymbolCode): "BTC/USDT" | "ETH/USDT" {
  return FHV_SYMBOL_CODE_TO_INSTRUMENT[symbol];
}

/** Streaming digest of bars whose open is in [startUtc, endUtc). */
export function digestNdjsonWindow(input: {
  filePath: string;
  startUtc: string;
  endUtc: string;
  expectedSymbol: "BTC/USDT" | "ETH/USDT";
}): string {
  assertPathDoesNotAccessBlindHoldoutPayload(input.filePath);
  const startMs = Date.parse(input.startUtc);
  const endMs = Date.parse(input.endUtc);
  const hasher = createStreamingBarSemanticHasher();
  const fd = openSync(input.filePath, "r");
  let remainder = "";
  const buffer = Buffer.alloc(65_536);
  let lineNumber = 0;
  let matched = 0;
  try {
    while (true) {
      const bytesRead = readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        remainder += buffer.subarray(0, bytesRead).toString("utf8");
      }
      const parts = remainder.split("\n");
      remainder = bytesRead > 0 ? (parts.pop() ?? "") : "";
      const lines = bytesRead > 0 ? parts : [...parts, remainder].filter((line) => line.length > 0);
      if (bytesRead <= 0 && remainder.length > 0) {
        lines.push(remainder);
        remainder = "";
      }
      for (const line of lines) {
        if (line.length === 0) {
          continue;
        }
        lineNumber += 1;
        const bar = fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, lineNumber));
        if (bar.symbol !== input.expectedSymbol) {
          fail("SYMBOL_MISMATCH", `window digest expected ${input.expectedSymbol}`);
        }
        const openMs = Date.parse(bar.barOpenTime);
        if (openMs >= startMs && openMs < endMs) {
          updateStreamingBarSemanticHasher(hasher, bar);
          matched += 1;
        }
      }
      if (bytesRead <= 0) {
        break;
      }
    }
  } finally {
    closeSync(fd);
  }
  if (matched === 0) {
    fail("REVISION_RISK_WINDOW_EMPTY", `no acquired bars in [${input.startUtc}, ${input.endUtc})`);
  }
  return finalizeStreamingBarSemanticDigest(hasher);
}
