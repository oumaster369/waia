import type { OrderRateStore } from "@/lib/trader/risk/trade-abuse.types";

type RateBucket = {
  timestampsMs: number[];
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
}

export function createInMemoryOrderRateStore(): InMemoryOrderRateStore {
  return new InMemoryOrderRateStore();
}
