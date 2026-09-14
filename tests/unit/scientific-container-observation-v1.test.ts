import { describe, expect, it } from "vitest";
import { normalizeScientificDockerTimestampV1 as normalize,
  scientificContainerObservationV1 as observe } from "../../scripts/trader/scientific-container-observation-v1";
import { reconcileScientificProcessVerdictV1 as reconcile } from "../../scripts/trader/scientific-process-verdict-v1";

function fixture() {
  const raw = { containerId: "b".repeat(64), startedAt: "2026-09-08T19:51:27.675955822Z",
    finishedAt: "2026-09-12T04:43:00.377755027Z", status: "exited", exitCode: 1,
    oomKilled: false, restartCount: 0 };
  const identity = { organizationId: "11111111-1111-1111-1111-111111111111",
    runId: "diagnostic-fixture", releaseSha: "a".repeat(40),
    attemptId: "22222222-2222-2222-2222-222222222222", containerId: raw.containerId,
    containerStartedAt: "2026-09-08T19:51:27.675Z" };
  return { raw, context: { identity, exactDockerStartedAt: raw.startedAt, observedAt: "2026-09-12T05:00:00.000Z" } };
}
describe("projected container observation", () => {
  it("preserves exit1 versus wrapper0 through the actual reconciler", () => {
    const { raw, context } = fixture(), before = structuredClone(raw);
    const container = observe(raw, context);
    expect(container?.finishedAt).toBe("2026-09-12T04:43:00.377Z");
    expect(reconcile({ expectedIdentity: context.identity, now: context.observedAt,
      maxObservationAgeMs: 1000, container, evidence: null,
      wrapper: { identity: context.identity, observedAt: context.observedAt, exitCode: 0 } }))
      .toMatchObject({ verdict: "FAILED", process: "FAILED", wrapperExitCode: 0, authorityGranted: false,
        issues: expect.arrayContaining(["PROCESS_FAILED", "WRAPPER_CONTAINER_CONFLICT"]) });
    expect(raw).toEqual(before);
  });
  it("does not infer a verified proposal from zero exit", () => {
    const { raw, context } = fixture(); raw.exitCode = 0;
    expect(reconcile({ expectedIdentity: context.identity, now: context.observedAt,
      maxObservationAgeMs: 1000, container: observe(raw, context), evidence: null }))
      .toMatchObject({ verdict: "UNKNOWN", process: "EXITED_ZERO", evidence: "UNKNOWN" });
  });
  it("maps Docker sentinel time and default zero to an unfinished running process", () => {
    const { raw, context } = fixture();
    expect(observe({ ...raw, status: "running", exitCode: 0, finishedAt: "0001-01-01T00:00:00Z" }, context))
      .toMatchObject({ state: "running", exitCode: null, finishedAt: null });
  });
  it.each([{ restartCount: 1 }, { containerId: "c".repeat(64) }, { status: "unknown" },
    { exitCode: -1 }, { exitCode: 256 }, { exitCode: "1" }, { oomKilled: "false" },
    { startedAt: "2026-09-08T19:51:27.675955823Z" }, { finishedAt: "2026-02-30T00:00:00Z" },
    { finishedAt: "2026-09-08T00:00:00Z" }, { finishedAt: "2026-09-13T00:00:00Z" },
    { finishedAt: "0001-01-01T00:00:00Z" }, { Env: ["PRIVATE_VALUE"] }])(
    "refuses malformed, wrong-invocation or unbounded projection %j", patch => {
      const { raw, context } = fixture(); expect(observe({ ...raw, ...patch }, context)).toBeNull();
    });
  it("rejects getters without evaluating them", () => {
    const { raw, context } = fixture();
    Object.defineProperty(raw, "exitCode", { enumerable: true, get: () => { throw Error("PRIVATE_VALUE"); } });
    expect(observe(raw, context)).toBeNull();
  });
  it("does not lose impossible event ordering within one millisecond", () => {
    const { raw, context } = fixture();
    expect(observe({ ...raw, finishedAt: "2026-09-08T19:51:27.675955821Z" }, context)).toBeNull();
    expect(observe({ ...raw, finishedAt: "2026-09-12T05:00:00.000000001Z" }, context)).toBeNull();
  });
  it.each([137, 143])("preserves exit %i without inventing a signal", exitCode => {
    const { raw, context } = fixture(); expect(observe({ ...raw, exitCode }, context))
      .toMatchObject({ exitCode, signal: null });
  });
  it("copies identity instead of retaining a mutable caller reference", () => {
    const { raw, context } = fixture(), result = observe(raw, context);
    context.identity.runId = "mutated"; expect(result?.identity.runId).toBe("diagnostic-fixture");
  });
});
describe("Docker timestamp normalization", () => {
  it.each(["2026-09-12T04:43:00Z", "2026-09-12T04:43:00.0Z", "2026-09-12T04:43:00.000000000Z"])(
    "normalizes valid precision %s", time => expect(normalize(time)).toBe("2026-09-12T04:43:00.000Z"));
  it.each([null, "", "2026-02-30T00:00:00Z", "2026-09-12T24:00:00Z", "2026-09-12T04:43:00+00:00",
    "2026-09-12T04:43:00.1234567890Z", "0001-01-01T00:00:00.000000000Z"])(
    "rejects malformed or empty timestamp %s", time => expect(normalize(time)).toBeNull());
});
