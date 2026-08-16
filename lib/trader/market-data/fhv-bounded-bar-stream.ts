import { createReadStream } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { Bar } from "@/lib/trader/intelligence/types";
import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  fhvBarsV2RecordToBar,
  parseFhvBarsV2Line,
} from "@/lib/trader/market-data/fhv-bars-v2-ndjson";
import { fhvOfficialPartitionFileRelativePath } from "@/lib/trader/market-data/fhv-partition-boundaries";

export class FhvBoundedBarStreamError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvBoundedBarStreamError";
  }
}

/** Yield bars from an NDJSON file without materializing the whole corpus. */
export async function* iterateFhvNdjsonBars(filePath: string): AsyncGenerator<Bar, void, void> {
  assertPathDoesNotAccessBlindHoldoutPayload(filePath);
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;
  try {
    for await (const line of lines) {
      if (line.length === 0) {
        continue;
      }
      lineNumber += 1;
      yield fhvBarsV2RecordToBar(parseFhvBarsV2Line(line, lineNumber));
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

/** Merge two already-sorted bar streams in event time with O(1) extra buffers. */
export async function* mergeChronologicalBarStreams(
  left: AsyncIterable<Bar>,
  right: AsyncIterable<Bar>,
): AsyncGenerator<Bar, void, void> {
  const leftIter = left[Symbol.asyncIterator]();
  const rightIter = right[Symbol.asyncIterator]();
  let leftNext = await leftIter.next();
  let rightNext = await rightIter.next();
  while (!leftNext.done || !rightNext.done) {
    if (leftNext.done) {
      yield rightNext.value;
      rightNext = await rightIter.next();
      continue;
    }
    if (rightNext.done) {
      yield leftNext.value;
      leftNext = await leftIter.next();
      continue;
    }
    const delta = Date.parse(leftNext.value.barOpenTime) - Date.parse(rightNext.value.barOpenTime);
    if (delta < 0 || (delta === 0 && leftNext.value.symbol.startsWith("BTC"))) {
      yield leftNext.value;
      leftNext = await leftIter.next();
    } else {
      yield rightNext.value;
      rightNext = await rightIter.next();
    }
  }
}

export function assertOfficialControlReplayDoesNotUseWholeCorpusLoader(
  officialEntrypointSource: string,
): void {
  if (officialEntrypointSource.includes("loadFhvPreHoldoutPartitionBars(")) {
    throw new FhvBoundedBarStreamError(
      "WHOLE_CORPUS_LOADER_FORBIDDEN",
      "official Control Replay entrypoint must not call loadFhvPreHoldoutPartitionBars",
    );
  }
}

/** Official economic Control Replay market surface: WALK_FORWARD BTC+ETH, streamed. */
export function streamOfficialPreHoldoutWalkForwardBars(datasetRoot: string): AsyncIterable<Bar> {
  const btcPath = join(
    datasetRoot,
    fhvOfficialPartitionFileRelativePath({ partition: "walk-forward", symbol: "BTCUSDT" }),
  );
  const ethPath = join(
    datasetRoot,
    fhvOfficialPartitionFileRelativePath({ partition: "walk-forward", symbol: "ETHUSDT" }),
  );
  return mergeChronologicalBarStreams(iterateFhvNdjsonBars(btcPath), iterateFhvNdjsonBars(ethPath));
}
