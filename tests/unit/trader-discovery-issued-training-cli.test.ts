import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/research/research-issued-training-diagnostic-postgres-v2", () => ({
  runResearchIssuedTrainingDiagnosticPostgresV2: vi.fn(),
}));

import {
  buildIssuedTrainingCliSummary,
  parseDiscoveryIssuedTrainingArgs,
  runDiscoveryIssuedTrainingBranch,
} from "@/scripts/trader/discovery-run";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";

const attemptId = "a12b3456-7890-4abc-8def-0123456789ab";
const validArgs = [
  "--run-issued-training=1",
  `--org-id=${RESEARCH_DEVELOPMENT_SOURCE_ORG_V1.toUpperCase()}`,
  `--attempt-id=${attemptId.toUpperCase()}`,
  "--trial-index=3",
  "--max-bars=256",
  "--max-bytes=1048576",
];

const committedResult = {
  status: "COMMITTED" as const,
  trace: {
    traceSha256: "a".repeat(64),
    stageRunId: "stage-run-1212-1",
    sourceIssuanceDigest: "b".repeat(64),
    bars: [{ close: "must-not-print" }],
    policy: { private: "must-not-print" },
    databaseUrl: "postgresql://must-not-print",
  },
};

describe("discovery CLI issued-source DEVELOPMENT mode", () => {
  it("captures a canonical bounded request and is absent unless explicitly selected", () => {
    const request = parseDiscoveryIssuedTrainingArgs(validArgs);
    expect(request).toEqual({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId,
      trialIndex: 3,
      limits: { maxBars: 256, maxBytes: 1_048_576 },
    });
    expect(Object.isFrozen(request)).toBe(true);
    expect(request && Object.isFrozen(request.limits)).toBe(true);
    expect(parseDiscoveryIssuedTrainingArgs(["--org-id=org", "--campaign-id=campaign"])).toBeNull();
  });

  it("leaves ordinary discovery invocations outside the issued-training branch", async () => {
    const authorize = vi.fn();
    const run = vi.fn();
    const result = await runDiscoveryIssuedTrainingBranch(
      ["--org-id=org", "--campaign-id=campaign"],
      { cliEnabled: true, authorize, run, print: vi.fn() },
    );
    expect(result).toEqual({ handled: false, exitCode: 0 });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    ["source preparation overlap", [...validArgs, "--prepare-source=1"]],
    ["duplicate mode flag", [...validArgs, "--run-issued-training=1"]],
    ["duplicate request field", [...validArgs, "--attempt-id=" + attemptId]],
    ["unknown flag", [...validArgs, "--blind=1"]],
    ["positional argument", [...validArgs, "unexpected"]],
    ["flag without a value", [...validArgs, "--max-bars"]],
    [
      "non-enabled value",
      validArgs.map((arg) =>
        arg === "--run-issued-training=1" ? "--run-issued-training=true" : arg,
      ),
    ],
    ["missing attempt", validArgs.filter((arg) => !arg.startsWith("--attempt-id="))],
    [
      "noncanonical integer",
      validArgs.map((arg) => (arg === "--trial-index=3" ? "--trial-index=03" : arg)),
    ],
    [
      "out-of-range bars",
      validArgs.map((arg) => (arg === "--max-bars=256" ? "--max-bars=4097" : arg)),
    ],
  ])("refuses %s before authorization or owner invocation", async (_label, argv) => {
    const authorize = vi.fn();
    const run = vi.fn();
    const print = vi.fn();
    const result = await runDiscoveryIssuedTrainingBranch(argv, {
      cliEnabled: true,
      authorize,
      run,
      print,
    });

    expect(result).toMatchObject({
      handled: true,
      exitCode: 1,
      error: "ISSUED_TRAINING_ARGUMENTS_INVALID",
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it("requires the WAIA trader CLI posture before authorization or execution", async () => {
    const authorize = vi.fn();
    const run = vi.fn();
    const result = await runDiscoveryIssuedTrainingBranch(validArgs, {
      cliEnabled: false,
      authorize,
      run,
      print: vi.fn(),
    });

    expect(result).toEqual({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("requires operator authorization before calling the issued-training owner", async () => {
    const authorize = vi.fn(() => {
      throw new Error("operator denied");
    });
    const run = vi.fn();
    const print = vi.fn();
    const result = await runDiscoveryIssuedTrainingBranch(validArgs, {
      cliEnabled: true,
      authorize,
      run,
      print,
    });

    expect(result).toEqual({ handled: true, exitCode: 1, error: "ISSUED_TRAINING_FAILED" });
    expect(authorize).toHaveBeenCalledOnce();
    expect(run).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it("calls the direct owner with captured input and prints only the safe summary", async () => {
    const order: string[] = [];
    const authorize = vi.fn(() => {
      order.push("authorize");
    });
    const run = vi.fn(async () => {
      order.push("owner");
      return committedResult;
    });
    const print = vi.fn();
    const result = await runDiscoveryIssuedTrainingBranch(validArgs, {
      cliEnabled: true,
      authorize,
      run,
      print,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(authorize).toHaveBeenCalledOnce();
    expect(order).toEqual(["authorize", "owner"]);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId,
      trialIndex: 3,
      limits: { maxBars: 256, maxBytes: 1_048_576 },
    });
    expect(print).toHaveBeenCalledWith({
      status: "COMMITTED",
      trace: {
        traceSha256: "a".repeat(64),
        stageRunId: "stage-run-1212-1",
        sourceIssuanceDigest: "b".repeat(64),
      },
      scientificQualified: false,
      capitalEligible: false,
    });
    expect(JSON.stringify(print.mock.calls)).not.toContain("must-not-print");
    expect(JSON.stringify(print.mock.calls)).not.toContain("postgresql://");
  });

  it("returns uncertainty without a fabricated trace and exits nonzero", async () => {
    const print = vi.fn();
    const run = vi.fn().mockResolvedValue({ status: "COMMIT_UNCERTAIN", trace: null });
    const result = await runDiscoveryIssuedTrainingBranch(validArgs, {
      cliEnabled: true,
      authorize: vi.fn(),
      run,
      print,
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(print).toHaveBeenCalledWith({
      status: "COMMIT_UNCERTAIN",
      trace: null,
      scientificQualified: false,
      capitalEligible: false,
    });
  });

  it("keeps direct summary serialization allowlisted", () => {
    expect(buildIssuedTrainingCliSummary(committedResult)).toEqual({
      status: "COMMITTED",
      trace: {
        traceSha256: "a".repeat(64),
        stageRunId: "stage-run-1212-1",
        sourceIssuanceDigest: "b".repeat(64),
      },
      scientificQualified: false,
      capitalEligible: false,
    });
  });
});
