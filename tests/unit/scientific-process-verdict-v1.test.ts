import { describe, expect, it } from "vitest";
import { reconcileScientificProcessVerdictV1 as reconcile,
  type ScientificProcessVerdictInputV1 } from "../../scripts/trader/scientific-process-verdict-v1";

function fixture(): ScientificProcessVerdictInputV1 {
  const identity = {
    organizationId: "11111111-1111-1111-1111-111111111111", runId: "synthetic-run",
    releaseSha: "a".repeat(40), attemptId: "22222222-2222-2222-2222-222222222222",
    containerId: "b".repeat(64), containerStartedAt: "2026-09-12T04:00:00.000Z",
  };
  const observation = { identity, observedAt: "2026-09-12T04:44:00.000Z" };
  return {
    expectedIdentity: identity, now: "2026-09-12T04:44:01.000Z", maxObservationAgeMs: 5_000,
    container: { ...observation, state: "exited", exitCode: 0,
      finishedAt: "2026-09-12T04:43:00.000Z", oomKilled: false, signal: null },
    wrapper: { ...observation, exitCode: 0 },
    preparation: { ...observation, phase: "PROPOSAL_AVAILABLE" },
    evidence: { ...observation, status: "VERIFIED", proposalContentDigestHex: "c".repeat(64) },
  };
}

describe("scientific process verdict diagnostics", () => {
  it("reports exact terminal process and independently verified evidence without authority", () => {
    expect(reconcile(fixture())).toEqual({
      schemaVersion: "waia.trader.scientific_process_verdict.v1",
      verdict: "TECHNICAL_RESULT_OBSERVED", process: "EXITED_ZERO", wrapperExitCode: 0,
      preparation: "PROPOSAL_AVAILABLE", evidence: "VERIFIED", proposalContentDigestHex: "c".repeat(64),
      issues: [], authorityGranted: false,
    });
  });

  it("does not require optional wrapper or journal diagnostics", () => {
    expect(reconcile({ ...fixture(), wrapper: null, preparation: null }).verdict).toBe("TECHNICAL_RESULT_OBSERVED");
  });

  it("retains actual container failure when the wrapper reports zero", () => {
    const input = fixture();
    const verdict = reconcile({ ...input, container: { ...input.container!, exitCode: 1 },
      preparation: { ...input.preparation!, phase: "FAILED" }, evidence: null });
    expect(verdict).toMatchObject({ verdict: "FAILED", process: "FAILED", wrapperExitCode: 0,
      preparation: "FAILED", evidence: "UNKNOWN", authorityGranted: false });
    expect(verdict.issues).toContain("WRAPPER_CONTAINER_CONFLICT");
  });

  it("preserves a verified receipt when later process cleanup fails", () => {
    const input = fixture();
    expect(reconcile({ ...input, container: { ...input.container!, exitCode: 1 } })).toMatchObject({
      verdict: "FAILED", process: "FAILED", evidence: "VERIFIED", proposalContentDigestHex: "c".repeat(64),
    });
  });

  it("does not treat a running container's default exit zero or wrapper zero as completion", () => {
    const input = fixture();
    const verdict = reconcile({ ...input, container: { ...input.container!, state: "running", finishedAt: null } });
    expect(verdict).toMatchObject({ verdict: "IN_PROGRESS", process: "RUNNING" });
    expect(verdict.issues).toContain("WRAPPER_CONTAINER_CONFLICT");
  });

  it.each(["created", "paused", "restarting"] as const)("does not complete a %s container", state => {
    const input = fixture();
    expect(reconcile({ ...input, container: { ...input.container!, state, finishedAt: null } }).verdict).toBe("UNKNOWN");
  });

  it("keeps missing container unknown even with verified evidence", () => {
    expect(reconcile({ ...fixture(), container: null })).toMatchObject({
      verdict: "UNKNOWN", process: "UNKNOWN", evidence: "VERIFIED", issues: ["CONTAINER_MISSING"],
    });
  });

  it.each([null, "ABSENT", "INVALID"] as const)("does not infer evidence from exit zero: %s", status => {
    const input = fixture();
    const evidence = status === null ? null : { identity: input.expectedIdentity, observedAt: input.now, status };
    const verdict = reconcile({ ...input, evidence });
    expect(verdict.verdict).toBe("UNKNOWN");
    expect(verdict.process).toBe("EXITED_ZERO");
    expect(verdict.proposalContentDigestHex).toBeNull();
  });

  it.each(["organizationId", "runId", "releaseSha", "attemptId", "containerId", "containerStartedAt"] as const)(
    "rejects a mismatched %s across every observation", key => {
      const input = fixture();
      const other = key === "containerStartedAt" ? "2026-09-12T03:00:00.000Z" :
        key === "runId" ? "other-run" : key === "releaseSha" ? "d".repeat(40) :
          key === "containerId" ? "d".repeat(64) : "33333333-3333-3333-3333-333333333333";
      for (const source of ["container", "wrapper", "preparation", "evidence"] as const) {
        const verdict = reconcile({ ...input, [source]: { ...input[source], identity: { ...input.expectedIdentity, [key]: other } } });
        expect(verdict.verdict).not.toBe("TECHNICAL_RESULT_OBSERVED");
      }
    });

  it.each(["2026-09-12T04:43:00.000Z", "2026-09-12T04:45:00.000Z", "not-a-date",
    "2026-02-30T00:00:00.000Z", "2026-09-12T03:59:00.000Z"])("rejects invalid/stale observation time %s", observedAt => {
    const input = fixture();
    for (const source of ["container", "wrapper", "preparation", "evidence"] as const) {
      expect(reconcile({ ...input, [source]: { ...input[source], observedAt } }).verdict)
        .not.toBe("TECHNICAL_RESULT_OBSERVED");
    }
  });

  it.each([{ exitCode: 137 }, { oomKilled: true }, { signal: 15 }, { state: "dead" as const }])(
    "treats exit, OOM, signal and dead state as process failures: %j", patch => {
      const input = fixture();
      expect(reconcile({ ...input, container: { ...input.container!, ...patch } }).process).toBe("FAILED");
    });

  it.each([{ exitCode: -1 }, { exitCode: 256 }, { exitCode: 0.5 }, { exitCode: null },
    { signal: 0 }, { signal: 65 }, { finishedAt: null },
    { finishedAt: "2026-09-12T03:00:00.000Z" }, { finishedAt: "2026-09-12T04:45:00.000Z" }])(
    "rejects malformed terminal container data: %j", patch => {
      const input = fixture();
      expect(reconcile({ ...input, container: { ...input.container!, ...patch } })).toMatchObject({
        verdict: "UNKNOWN", process: "UNKNOWN", issues: ["CONTAINER_INVALID"],
      });
    });

  it("refuses a contradictory wrapper failure without rewriting container success", () => {
    const input = fixture();
    expect(reconcile({ ...input, wrapper: { ...input.wrapper!, exitCode: 1 } })).toMatchObject({
      verdict: "UNKNOWN", process: "EXITED_ZERO", wrapperExitCode: 1, issues: ["WRAPPER_CONTAINER_CONFLICT"],
    });
  });

  it("refuses a wrapper termination observation predating container termination", () => {
    const input = fixture();
    const verdict = reconcile({ ...input, maxObservationAgeMs: 120_000,
      wrapper: { ...input.wrapper!, observedAt: "2026-09-12T04:42:59.000Z" } });
    expect(verdict.verdict).toBe("UNKNOWN");
    expect(verdict.issues).toContain("WRAPPER_CONTAINER_CONFLICT");
  });

  it("does not call matching OOM exit codes a wrapper discrepancy", () => {
    const input = fixture();
    const verdict = reconcile({ ...input,
      container: { ...input.container!, exitCode: 137, oomKilled: true },
      wrapper: { ...input.wrapper!, exitCode: 137 } });
    expect(verdict.verdict).toBe("FAILED");
    expect(verdict.issues).not.toContain("WRAPPER_CONTAINER_CONFLICT");
  });

  it.each(["STARTED", "PROGRESS", "FAILED"] as const)("does not reconcile a %s journal into success", phase => {
    const input = fixture();
    const verdict = reconcile({ ...input, preparation: { ...input.preparation!, phase } });
    expect(verdict.verdict).not.toBe("TECHNICAL_RESULT_OBSERVED");
    expect(verdict.evidence).toBe("VERIFIED");
    expect(verdict.issues).toContain("PREPARATION_EVIDENCE_CONFLICT");
  });

  it.each(["", "c".repeat(63), "g".repeat(64)])("rejects malformed verified evidence digest %s", proposalContentDigestHex => {
    const input = fixture();
    expect(reconcile({ ...input, evidence: { ...input.evidence!, status: "VERIFIED", proposalContentDigestHex } }))
      .toMatchObject({ verdict: "UNKNOWN", evidence: "INVALID", proposalContentDigestHex: null });
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5])("refuses invalid observation budget %s", maxObservationAgeMs => {
    expect(reconcile({ ...fixture(), maxObservationAgeMs }).issues).toEqual(["INVALID_EXPECTATION"]);
  });

  it("rejects malformed runtime shapes despite static caller types", () => {
    for (const source of ["container", "wrapper", "preparation", "evidence"] as const) {
      expect(reconcile({ ...fixture(), [source]: {} } as unknown as ScientificProcessVerdictInputV1).verdict)
        .not.toBe("TECHNICAL_RESULT_OBSERVED");
    }
    expect(reconcile(null as unknown as ScientificProcessVerdictInputV1).issues).toEqual(["INVALID_EXPECTATION"]);
  });

  it("is deterministic, leaves inputs unchanged and projects no caller extras", () => {
    const input = fixture();
    const before = JSON.stringify(input);
    const first = reconcile({ ...input, privateDiagnostic: "do-not-echo" } as ScientificProcessVerdictInputV1);
    expect(reconcile(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(JSON.stringify(first)).not.toContain("do-not-echo");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.issues)).toBe(true);
  });
});
