/** Outcome of bounded v1 demo readiness write (one monotonic step max) — content-free for logs. */
export type ReadinessDemoAdvanceResult =
  | { status: "skipped"; reason: "not_eligible" | "missing_state" | "all_indicators_confirmed" }
  | { status: "applied"; indicatorIndex: number; from: number; to: number }
  | { status: "noop"; reason: "stale_state" };
