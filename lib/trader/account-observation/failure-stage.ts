import "server-only";

/** Source-owned labels only; no dependency/error/request values enter telemetry. */
export const OBSERVATION_FAILURE_STAGES = [
  "REQUEST", "SESSION_INITIAL", "SESSION_RECHECK", "RUNTIME_INIT", "ENTITLEMENT",
  "MEMBERSHIP", "OPERATOR_PERMISSION", "ADMIN_LIST_SCOPE", "PROJECTION_CONFIG",
  "PROJECTION_REQUEST", "PROJECTION_FETCH", "PROJECTION_STATUS", "PROJECTION_REPRESENTATION",
  "PROJECTION_BODY", "PROJECTION_MAC", "BINDING_VALIDATION", "OBSERVATION_VALIDATION", "DEADLINE",
] as const;
export type ObservationFailureStage = (typeof OBSERVATION_FAILURE_STAGES)[number];
export type ObservationFailureOutcome = "THREW" | "TIMEOUT" | "HTTP_401" | "HTTP_403" | "HTTP_404" | "HTTP_5XX" | "HTTP_OTHER";
export type ObservationFailureRecord = Readonly<{
  event: "ACCOUNT_OBSERVATION_FAILURE";
  stage: ObservationFailureStage;
  outcome: ObservationFailureOutcome;
  elapsedMs: number;
}>;
export type ObservationFailureTrace = Readonly<{
  enter(stage: ObservationFailureStage): void;
  capture(outcome: ObservationFailureOutcome): void;
  report(outcome: ObservationFailureOutcome): void;
  complete(): void;
}>;

/** One bounded server log per failed request. Sink/clock failures cannot change a response. */
export function createObservationFailureTrace(
  sink: (record: ObservationFailureRecord) => void = record => { console.warn(JSON.stringify(record)); },
  clock: () => number = () => performance.now(),
): ObservationFailureTrace {
  const now = () => { try { return clock(); } catch { return 0; } };
  const started = now();
  let stage: ObservationFailureStage = "REQUEST";
  let captured: { stage: ObservationFailureStage; outcome: ObservationFailureOutcome } | undefined;
  let closed = false;
  const outcomes: readonly string[] = ["THREW", "TIMEOUT", "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_5XX", "HTTP_OTHER"];
  return Object.freeze({
    enter(next: ObservationFailureStage) {
      if (!closed && !captured && OBSERVATION_FAILURE_STAGES.includes(next)) stage = next;
    },
    capture(outcome: ObservationFailureOutcome) {
      if (!closed && !captured && outcomes.includes(outcome)) captured = { stage, outcome };
    },
    report(outcome: ObservationFailureOutcome) {
      if (closed) return;
      closed = true;
      const failure = outcome === "TIMEOUT" ? { stage: captured?.stage ?? stage, outcome } :
        captured ?? { stage, outcome: outcomes.includes(outcome) ? outcome : "THREW" as const };
      const elapsed = now() - started;
      const elapsedMs = Number.isFinite(elapsed) ? Math.max(0, Math.min(5000, Math.floor(elapsed))) : 0;
      try { sink(Object.freeze({ event: "ACCOUNT_OBSERVATION_FAILURE", ...failure, elapsedMs })); }
      catch { /* Telemetry never throws and never serializes sink errors. */ }
    },
    complete() { closed = true; },
  });
}
