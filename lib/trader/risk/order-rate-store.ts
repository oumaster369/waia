import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import type { OrderRateStore } from "@/lib/trader/risk/trade-abuse.types";

type RateBucket = {
  timestampsMs: number[];
};

export type FhvOrderRateStoreSnapshotV1 = {
  schemaVersion: "fhv-order-rate-store/v1";
  buckets: Record<string, number[]>;
  contentDigest: string;
};

export class InMemoryOrderRateStore implements OrderRateStore {
  private readonly buckets = new Map<string, RateBucket>();

  recordAndCount(key: string, nowMs: number, windowMs: number): number {
    const bucket = this.buckets.get(key) ?? { timestampsMs: [] };
    const windowStart = nowMs - windowMs;
    bucket.timestampsMs = bucket.timestampsMs.filter((ts) => ts > windowStart);
    bucket.timestampsMs.push(nowMs);
    this.buckets.set(key, bucket);
    return bucket.timestampsMs.length;
  }

  clear(): void {
    this.buckets.clear();
  }

  captureSnapshot(): FhvOrderRateStoreSnapshotV1 {
    const buckets = Object.fromEntries(
      [...this.buckets.entries()].map(([key, bucket]) => [key, [...bucket.timestampsMs]]),
    );
    const body = {
      schemaVersion: "fhv-order-rate-store/v1" as const,
      buckets,
    };
    return {
      ...body,
      contentDigest: computeStableJsonDigest(body),
    };
  }

  restoreSnapshot(snapshot: FhvOrderRateStoreSnapshotV1): void {
    const body = {
      schemaVersion: snapshot.schemaVersion,
      buckets: snapshot.buckets,
    };
    if (computeStableJsonDigest(body) !== snapshot.contentDigest) {
      throw new Error("[fhv] order rate store snapshot contentDigest mismatch");
    }
    this.buckets.clear();
    for (const [key, timestampsMs] of Object.entries(snapshot.buckets)) {
      this.buckets.set(key, { timestampsMs: [...timestampsMs] });
    }
  }
}

export function createInMemoryOrderRateStore(): InMemoryOrderRateStore {
  return new InMemoryOrderRateStore();
}
