import { describe, expect, it } from "vitest";

import {
  deriveTrialIntegrityState,
  type MiTrialIntegrityEvent,
} from "@/lib/trader/mi/trial-integrity.types";

function buildEvent(
  overrides: Partial<MiTrialIntegrityEvent> & Pick<MiTrialIntegrityEvent, "seq" | "eventType">,
): MiTrialIntegrityEvent {
  return {
    id: overrides.id ?? `event-${overrides.seq}`,
    organizationId: "00000000-0000-4000-8000-00000000e291",
    trialId: "00000000-0000-4000-8000-00000000f291",
    reasonCode: overrides.reasonCode ?? "look_ahead_contamination",
    rationale: overrides.rationale ?? "rationale",
    causeRef: overrides.causeRef ?? null,
    schemaVersion: "mi-trial-integrity-v1",
    eventTime: overrides.eventTime ?? new Date(`2026-06-22T12:0${overrides.seq}:00.000Z`),
    ingestTime: overrides.ingestTime ?? new Date(`2026-06-22T12:0${overrides.seq}:01.000Z`),
    recordedBy: overrides.recordedBy ?? "recorder",
    contentDigest: overrides.contentDigest ?? "digest",
    createdAt: overrides.createdAt ?? new Date("2026-06-22T12:00:00.000Z"),
    ...overrides,
  };
}

describe("deriveTrialIntegrityState (DEE-291 / LD-5a.2c fold)", () => {
  it("returns valid when no events exist", () => {
    expect(deriveTrialIntegrityState([])).toEqual({
      status: "valid",
      reasonCode: null,
      since: null,
      latestEventId: null,
    });
  });

  it("derives invalidated from a single invalidation event", () => {
    const event = buildEvent({ seq: 1, eventType: "invalidated" });
    expect(deriveTrialIntegrityState([event])).toEqual({
      status: "invalidated",
      reasonCode: "look_ahead_contamination",
      since: event.eventTime,
      latestEventId: event.id,
    });
  });

  it("latest-transition-wins when multiple invalidations exist", () => {
    const first = buildEvent({
      seq: 1,
      eventType: "invalidated",
      reasonCode: "look_ahead_contamination",
      eventTime: new Date("2026-06-22T12:00:00.000Z"),
    });
    const second = buildEvent({
      seq: 2,
      eventType: "invalidated",
      reasonCode: "computation_defect",
      eventTime: new Date("2026-06-22T13:00:00.000Z"),
    });

    expect(deriveTrialIntegrityState([first, second])).toEqual({
      status: "invalidated",
      reasonCode: "computation_defect",
      since: second.eventTime,
      latestEventId: second.id,
    });
  });

  it("derives valid when latest event is reinstated (reserved enum)", () => {
    const invalidated = buildEvent({
      seq: 1,
      eventType: "invalidated",
      eventTime: new Date("2026-06-22T12:00:00.000Z"),
    });
    const reinstated = buildEvent({
      seq: 2,
      eventType: "reinstated",
      reasonCode: null,
      eventTime: new Date("2026-06-22T14:00:00.000Z"),
    });

    expect(deriveTrialIntegrityState([invalidated, reinstated])).toEqual({
      status: "valid",
      reasonCode: null,
      since: reinstated.eventTime,
      latestEventId: reinstated.id,
    });
  });
});
