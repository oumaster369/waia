import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/research/research-issued-training-diagnostic-postgres-v2", () => ({
  runResearchIssuedTrainingDiagnosticPostgresV2: vi.fn(),
  selectResearchIssuedTrainingFamilyPostgresV1: vi.fn(),
}));

import {
  parseDiscoveryTrainingFamilySelectionArgs,
  runDiscoveryTrainingFamilySelectionBranch,
} from "@/scripts/trader/discovery-run";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from
  "@/lib/trader/research/research-development-source-contract-v1";

const attemptId = "a12b3456-7890-4abc-8def-0123456789ab";
const args = [
  "--select-issued-training=1",
  `--org-id=${RESEARCH_DEVELOPMENT_SOURCE_ORG_V1}`,
  `--attempt-id=${attemptId}`,
  "--max-bars=256",
  "--max-bytes=1048576",
  "--max-trace-bytes=2097152",
];

const receipt = {
  schemaVersion: "waia.research.training-family-selection.v1",
  authority: "DEVELOPMENT_NONQUALIFYING_SELECTION_ONLY",
  contentDigest: "a".repeat(64),
  selectedIndex: 1,
  scientificQualified: false,
  capitalEligible: false,
  sourceAvailability: "PIT_SOURCE_AVAILABILITY_NOT_ESTABLISHED",
  trades: [{ close: "sensitive-bar" }],
  databaseUrl: "postgresql://sensitive-dsn",
};

describe("discovery CLI complete issued-family selection", () => {
  it("is opt-in and leaves ordinary discovery outside this branch", async () => {
    const authorize = vi.fn();
    const run = vi.fn();
    const print = vi.fn();
    expect(parseDiscoveryTrainingFamilySelectionArgs(["--campaign-id=campaign"])).toBeNull();
    await expect(runDiscoveryTrainingFamilySelectionBranch(["--campaign-id=campaign"], {
      cliEnabled: true, authorize, run: run as never, print,
    })).resolves.toEqual({ handled: false, exitCode: 0 });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it("captures canonical bounded arguments and freezes the request", () => {
    const request = parseDiscoveryTrainingFamilySelectionArgs(args);
    expect(request).toEqual({ organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId, limits: { maxBars: 256, maxBytes: 1_048_576, maxTraceBytes: 2_097_152 } });
    expect(Object.isFrozen(request)).toBe(true);
    expect(request && Object.isFrozen(request.limits)).toBe(true);
  });

  it.each([
    ["missing selector value", args.map(arg => arg.replace("--select-issued-training=1", "--select-issued-training="))],
    ["missing org", args.filter(arg => !arg.startsWith("--org-id="))],
    ["missing attempt", args.filter(arg => !arg.startsWith("--attempt-id="))],
    ["missing trace budget", args.filter(arg => !arg.startsWith("--max-trace-bytes="))],
    ["duplicate selector", [...args, "--select-issued-training=1"]],
    ["duplicate attempt", [...args, `--attempt-id=${attemptId}`]],
    ["unknown flag", [...args, "--blind=1"]],
    ["mixed diagnostic mode", [...args, "--run-issued-training=1"]],
    ["mixed source-preparation mode", [...args, "--prepare-source=1"]],
    ["positional argument", [...args, "unexpected"]],
    ["invalid selector value", args.map(arg => arg === "--select-issued-training=1" ? "--select-issued-training=true" : arg)],
    ["noncanonical integer", args.map(arg => arg === "--max-bars=256" ? "--max-bars=0256" : arg)],
    ["oversized trace budget", args.map(arg => arg === "--max-trace-bytes=2097152" ? "--max-trace-bytes=33554433" : arg)],
  ])("refuses %s before authorization or owner invocation", async (_label, argv) => {
    const authorize = vi.fn();
    const run = vi.fn();
    const print = vi.fn();
    await expect(runDiscoveryTrainingFamilySelectionBranch(argv, {
      cliEnabled: true, authorize, run: run as never, print,
    })).resolves.toMatchObject({ handled: true, exitCode: 1, error: "FAMILY_SELECTION_ARGUMENTS_INVALID" });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it("requires WAIA trader CLI posture before authorization or any owner call", async () => {
    const authorize = vi.fn();
    const run = vi.fn();
    const result = await runDiscoveryTrainingFamilySelectionBranch(args, {
      cliEnabled: false, authorize, run: run as never, print: vi.fn(),
    });
    expect(result).toEqual({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    expect(authorize).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("authorizes before the owner and passes only the synchronously captured request", async () => {
    const mutableArgs = [...args];
    const order: string[] = [];
    const authorize = vi.fn(() => {
      order.push("authorize");
      mutableArgs.splice(0, mutableArgs.length, "--select-issued-training=0", "--unknown=secret");
    });
    const run = vi.fn(async () => {
      order.push("owner");
      return { status: "COMMITTED" as const, receipt };
    });
    const print = vi.fn();
    const result = await runDiscoveryTrainingFamilySelectionBranch(mutableArgs, {
      cliEnabled: true, authorize, run: run as never, print,
    });
    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(order).toEqual(["authorize", "owner"]);
    expect(run).toHaveBeenCalledOnce();
    expect(run).toHaveBeenCalledWith({ organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId, limits: { maxBars: 256, maxBytes: 1_048_576, maxTraceBytes: 2_097_152 } });
    expect(print).toHaveBeenCalledWith({ status: "COMMITTED", receiptDigest: "a".repeat(64),
      selectedIndex: 1, scientificQualified: false, capitalEligible: false });
    expect(JSON.stringify(print.mock.calls)).not.toContain("sensitive-bar");
    expect(JSON.stringify(print.mock.calls)).not.toContain("postgresql://");
  });

  it("prints no selected index for uncertain commit, exits nonzero, and leaks no receipt", async () => {
    const print = vi.fn();
    const run = vi.fn(async () => ({ status: "COMMIT_UNCERTAIN" as const, receipt: null }));
    const result = await runDiscoveryTrainingFamilySelectionBranch(args, {
      cliEnabled: true, authorize: vi.fn(), run: run as never, print,
    });
    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(print).toHaveBeenCalledWith({ status: "COMMIT_UNCERTAIN", receiptDigest: null,
      selectedIndex: null, scientificQualified: false, capitalEligible: false });
    expect(JSON.stringify(print.mock.calls)).not.toContain("sensitive");
  });

  it("returns only a generic refusal when authorization or owner fails", async () => {
    const print = vi.fn();
    const denied = await runDiscoveryTrainingFamilySelectionBranch(args, {
      cliEnabled: true,
      authorize: () => { throw new Error("postgresql://sensitive-auth-error"); },
      run: vi.fn() as never, print,
    });
    expect(denied).toEqual({ handled: true, exitCode: 1, error: "FAMILY_SELECTION_FAILED" });
    expect(print).not.toHaveBeenCalled();
    const failed = await runDiscoveryTrainingFamilySelectionBranch(args, {
      cliEnabled: true, authorize: vi.fn(),
      run: vi.fn(async () => { throw new Error("sensitive owner details"); }) as never, print,
    });
    expect(failed).toEqual({ handled: true, exitCode: 1, error: "FAMILY_SELECTION_FAILED" });
    expect(print).not.toHaveBeenCalled();
    expect(JSON.stringify([denied, failed])).not.toContain("sensitive");
  });
});
