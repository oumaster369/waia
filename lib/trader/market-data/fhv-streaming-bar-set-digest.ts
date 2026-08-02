import { createHash, type Hash } from "node:crypto";

import {
  RESEARCH_DATASET_SCHEMA_VERSION,
  finalizeBarSetDigestFromBarDigests,
} from "@/lib/trader/market-data/research-dataset";

const STREAM_PREFIX = '{"barDigests":[';
const STREAM_SUFFIX = `],"schemaVersion":"${RESEARCH_DATASET_SCHEMA_VERSION}"}`;

/** Incremental hasher matching canonical JSON from finalizeBarSetDigestFromBarDigests. */
export class StreamingBarSetDigestHasher {
  private readonly hash: Hash = createHash("sha256");
  private count = 0;
  private finalized = false;

  constructor() {
    this.hash.update(STREAM_PREFIX, "utf8");
  }

  appendBarDigest(digest: string): void {
    if (this.finalized) {
      throw new Error("[fhv] streaming bar-set digest hasher already finalized");
    }
    if (this.count > 0) {
      this.hash.update(",", "utf8");
    }
    this.hash.update(JSON.stringify(digest), "utf8");
    this.count += 1;
  }

  finalize(): string {
    if (this.finalized) {
      throw new Error("[fhv] streaming bar-set digest hasher already finalized");
    }
    this.finalized = true;
    this.hash.update(STREAM_SUFFIX, "utf8");
    return this.hash.digest("hex");
  }

  get appendedCount(): number {
    return this.count;
  }
}

export function finalizeBarSetDigestStreaming(digests: Iterable<string>): string {
  const hasher = new StreamingBarSetDigestHasher();
  for (const digest of digests) {
    hasher.appendBarDigest(digest);
  }
  return hasher.finalize();
}

export function assertStreamingBarSetDigestParity(barDigests: readonly string[]): void {
  const legacy = finalizeBarSetDigestFromBarDigests(barDigests);
  const streaming = finalizeBarSetDigestStreaming(barDigests);
  if (legacy !== streaming) {
    throw new Error(
      `[fhv] streaming bar-set digest parity failure: legacy=${legacy} streaming=${streaming}`,
    );
  }
}
