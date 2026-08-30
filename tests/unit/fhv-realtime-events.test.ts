import { describe, expect, it } from "vitest";

import { buildFhvOperatorStatusV1 } from "@/lib/trader/observability/build-fhv-operator-status-v1";
import {
  encodeFhvSseEvent,
  FhvSseFrameBuffer,
  projectFhvRealtimeEvents,
} from "@/lib/trader/observability/fhv-realtime-events";

const ORG_ID = "00000000-0000-4000-8000-0000000785aa";
const RUN_ID = "dee-785-realtime-stream";

describe("DEE-785 realtime observer event contract", () => {
  it("projects a complete historical-only snapshot with one run binding", () => {
    const status = buildFhvOperatorStatusV1({
      organizationId: ORG_ID,
      runId: RUN_ID,
      phase: "WALK_FORWARD",
      codeSha: "sha",
      artifactDigest: "artifact",
      datasetSeal: "seal",
      datasetDigest: "dataset",
      configurationDigest: "config",
      barsProcessed: 250,
      barsTotal: 1_000,
    });
    const events = projectFhvRealtimeEvents(status);

    expect(events.map((item) => item.kind)).toEqual([
      "campaign.progress",
      "account.balance",
      "position.snapshot",
      "trade.snapshot",
      "decision.snapshot",
      "checkpoint",
      "risk",
      "gate",
    ]);
    expect(events.every((item) => item.organizationId === ORG_ID)).toBe(true);
    expect(events.every((item) => item.campaignRunId === RUN_ID)).toBe(true);
    expect(events.every((item) => item.source === "HISTORICAL_SIMULATION")).toBe(true);
    expect(events.find((item) => item.kind === "account.balance")?.payload).toMatchObject({
      accountKind: "HISTORICAL_VIRTUAL",
      delta24h: null,
      delta24hPct: null,
    });
    expect(events.find((item) => item.kind === "gate")?.payload).toMatchObject({
      holdout: { state: "SEALED_NOT_ACCESSED", gate: "CLOSED" },
    });
    expect(JSON.stringify(events)).not.toMatch(/api.?key|credential|real.?balance/i);
    expect(encodeFhvSseEvent(events[0])).toContain(`id: ${RUN_ID}:250:`);
  });

  it("bounds slow-consumer memory and retains the newest complete snapshot", () => {
    const buffer = new FhvSseFrameBuffer(4);
    buffer.enqueueSnapshot(["old-1", "old-2", "old-3"]);
    buffer.enqueueSnapshot(["new-1", "new-2"]);
    expect([buffer.shift(), buffer.shift()]).toEqual(["new-1", "new-2"]);
    expect(buffer.length).toBe(0);
    expect(() => buffer.enqueueSnapshot(["1", "2", "3", "4", "5"])).toThrow(
      "SSE_SNAPSHOT_TOO_LARGE",
    );
  });
});
