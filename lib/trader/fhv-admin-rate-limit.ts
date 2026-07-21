import {
  checkFhvAdminCommandRateLimitInMemory,
  resetFhvAdminCommandRateLimitsForTests,
} from "@/lib/trader/fhv-admin-rate-limit-durable";

/** @deprecated Use durable audit-backed rate limiting in production handlers. */
export function checkFhvAdminCommandRateLimit(
  operatorId: string,
  nowMs = Date.now(),
  limit?: number,
): ReturnType<typeof checkFhvAdminCommandRateLimitInMemory> {
  return checkFhvAdminCommandRateLimitInMemory(operatorId, nowMs, limit);
}

export { resetFhvAdminCommandRateLimitsForTests };
