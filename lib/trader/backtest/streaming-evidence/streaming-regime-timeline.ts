import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Regime } from "@/lib/trader/intelligence/types";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import {
  computeChunkDigest,
  computePayloadDigest,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import {
  REGIME_TIMELINE_SCHEMA_VERSION,
  type RegimeTimelineChunkEnvelope,
  type RegimeTimelineEntry,
} from "@/lib/trader/backtest/streaming-evidence/streaming-evidence.types";
import type { PaperCycleResult } from "@/lib/trader/paper/paper-cycle.types";

const TIMELINE_BATCH_SIZE = 128;

function formatSeq(seq: number): string {
  return String(seq).padStart(6, "0");
}

export class StreamingRegimeTimelineWriter {
  private readonly timelineDir: string;
  private batch: RegimeTimelineEntry[] = [];
  private nextSeq = 0;
  private chunkCountValue = 0;

  constructor(runDir: string) {
    this.timelineDir = join(runDir, "timeline");
    mkdirSync(this.timelineDir, { recursive: true });
  }

  append(_cycleIndex: number, result: PaperCycleResult): void {
    this.batch.push({
      evaluatedAtMs: new Date(result.evaluation.msv.evaluatedAt).getTime(),
      regime: result.evaluation.msv.derived.regime,
    });
    if (this.batch.length >= TIMELINE_BATCH_SIZE) {
      this.flush();
    }
  }

  flush(): void {
    if (this.batch.length === 0) {
      return;
    }
    const payloadDigest = computePayloadDigest(this.batch);
    const envelopeWithoutDigest = {
      schemaVersion: REGIME_TIMELINE_SCHEMA_VERSION,
      seq: this.nextSeq,
      entries: this.batch,
      payloadDigest,
    };
    const chunkDigest = computeChunkDigest(
      envelopeWithoutDigest as unknown as Parameters<typeof computeChunkDigest>[0],
    );
    const envelope: RegimeTimelineChunkEnvelope = {
      ...envelopeWithoutDigest,
      chunkDigest,
    };
    writeFileAtomic(
      join(this.timelineDir, `timeline-${formatSeq(this.nextSeq)}.json`),
      JSON.stringify(envelope),
    );
    this.nextSeq += 1;
    this.chunkCountValue += 1;
    this.batch = [];
  }

  chunkCount(): number {
    return this.chunkCountValue + (this.batch.length > 0 ? 1 : 0);
  }
}

export type StreamingRegimeTimelineWriterHandle = StreamingRegimeTimelineWriter;

export class StreamingRegimeTimelineReader {
  private readonly timelineDir: string;
  private cachedEntries: RegimeTimelineEntry[] | null = null;

  constructor(runDir: string) {
    this.timelineDir = join(runDir, "timeline");
  }

  private loadEntries(): RegimeTimelineEntry[] {
    if (this.cachedEntries) {
      return this.cachedEntries;
    }
    if (!existsSync(this.timelineDir)) {
      this.cachedEntries = [];
      return this.cachedEntries;
    }
    const files = readdirSync(this.timelineDir)
      .filter((name: string) => name.startsWith("timeline-") && name.endsWith(".json"))
      .sort((a: string, b: string) => a.localeCompare(b));

    const entries: RegimeTimelineEntry[] = [];
    for (const file of files) {
      const envelope = JSON.parse(
        readFileSync(join(this.timelineDir, file), "utf8"),
      ) as RegimeTimelineChunkEnvelope;
      entries.push(...envelope.entries);
    }
    this.cachedEntries = entries;
    return entries;
  }

  *iterate(): Generator<RegimeTimelineEntry> {
    for (const entry of this.loadEntries()) {
      yield entry;
    }
  }

  resolveRegimeAtTimestamp(timestamp: Date): Regime {
    const targetMs = timestamp.getTime();
    const timeline = this.loadEntries();
    let regime: Regime = timeline[0]?.regime ?? "RANGE";
    for (const entry of timeline) {
      if (entry.evaluatedAtMs <= targetMs) {
        regime = entry.regime;
      } else {
        break;
      }
    }
    return regime;
  }
}

export function buildCycleRegimeTimelineFromReader(
  reader: StreamingRegimeTimelineReader,
): RegimeTimelineEntry[] {
  return [...reader.iterate()];
}
