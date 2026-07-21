import { FHV_COMMAND_RATE_LIMIT_PER_HOUR } from "@/lib/trader/observability/fhv-observability.constants";

type RateLimitBucket = {
  timestamps: number[];
};

const buckets = new Map<string, RateLimitBucket>();

export function checkFhvAdminCommandRateLimit(
  operatorId: string,
  nowMs = Date.now(),
  limit = FHV_COMMAND_RATE_LIMIT_PER_HOUR,
): { allowed: boolean; remaining: number } {
  const windowMs = 60 * 60 * 1000;
  const bucket = buckets.get(operatorId) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((ts) => nowMs - ts < windowMs);
  if (bucket.timestamps.length >= limit) {
    buckets.set(operatorId, bucket);
    return { allowed: false, remaining: 0 };
  }
  bucket.timestamps.push(nowMs);
  buckets.set(operatorId, bucket);
  return { allowed: true, remaining: limit - bucket.timestamps.length };
}

export function resetFhvAdminCommandRateLimitsForTests(): void {
  buckets.clear();
}
