import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/trader/research/research-development-source-owner-postgres-v1", () => ({
  prepareResearchDevelopmentSourcePostgresV1: vi.fn(),
}));

import {
  parseDiscoverySourcePreparationArgs,
  runDiscoverySourcePreparationBranch,
} from "@/scripts/trader/discovery-run";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from
  "@/lib/trader/research/research-development-source-contract-v1";

const validArgs = [
  "--prepare-source=1",
  "--org-id=" + RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
  "--command-id=source-cli-test-1",
  "--symbol=BTCUSDT",
  "--initial-record-index=0",
  "--observation-bar-count=2",
  "--gap-bar-count=1",
  "--training-bar-count=3",
];

describe("discovery CLI source-preparation mode", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("parses only the bounded source-selection request", () => {
    expect(parseDiscoverySourcePreparationArgs(validArgs)).toEqual({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      commandId: "source-cli-test-1",
      symbol: "BTCUSDT",
      initialRecordIndex: 0,
      observationBarCount: 2,
      gapBarCount: 1,
      trainingBarCount: 3,
    });
    expect(parseDiscoverySourcePreparationArgs(["--org-id=org", "--campaign-id=x"])).toBeNull();
  });

  it.each([
    ["duplicate preparation mode", [...validArgs, "--prepare-source=1"]],
    ["duplicate selection", [...validArgs, "--command-id=other"]],
    ["ordinary discovery flag mixed in", [...validArgs, "--campaign-id=campaign"]],
    ["live discovery flag mixed in", [...validArgs, "--enable=1"]],
    ["caller-selected qualification path", [...validArgs, "--qualification-path=/tmp/receipt"]],
    ["positional argument", [...validArgs, "unexpected"]],
    ["preparation mode with value other than one", validArgs.map((arg) =>
      arg === "--prepare-source=1" ? "--prepare-source=true" : arg)],
  ])("refuses %s before invoking the owner", async (_label, argv) => {
    const authorize = vi.fn();
    const prepare = vi.fn();
    const print = vi.fn();
    const result = await runDiscoverySourcePreparationBranch(argv, {
      cliEnabled: true,
      authorize,
      prepare,
      print,
    });

    expect(result).toMatchObject({ handled: true, exitCode: 1 });
    expect(authorize).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it.each(["01", "+1", "-1", "1e2", " 2", "9007199254740992"])(
    "refuses noncanonical or unsafe numeric input %s",
    async (numeric) => {
      const argv = validArgs.map((arg) => arg.startsWith("--initial-record-index=")
        ? "--initial-record-index=" + numeric
        : arg);
      const prepare = vi.fn();
      const result = await runDiscoverySourcePreparationBranch(argv, {
        cliEnabled: true,
        authorize: vi.fn(),
        prepare,
        print: vi.fn(),
      });
      expect(result.exitCode).toBe(1);
      expect(prepare).not.toHaveBeenCalled();
    },
  );

  it("refuses a non-CLI invocation before authorization or any database-owning callback", async () => {
    const authorize = vi.fn();
    const prepare = vi.fn();
    const result = await runDiscoverySourcePreparationBranch(validArgs, {
      cliEnabled: false,
      authorize,
      prepare,
      print: vi.fn(),
    });

    expect(result).toMatchObject({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    expect(authorize).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("authorizes and calls only the preparation owner, printing receipt and observation", async () => {
    const authorize = vi.fn();
    const prepare = vi.fn().mockResolvedValue({
      status: "COMMITTED",
      issuance: { contentDigest: "receipt-digest" },
      observation: [{ close: "100.25" }],
      ignored: "not exposed",
    });
    const print = vi.fn();

    const result = await runDiscoverySourcePreparationBranch(validArgs, {
      cliEnabled: true,
      authorize,
      prepare,
      print,
    });

    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(authorize).toHaveBeenCalledOnce();
    expect(prepare).toHaveBeenCalledOnce();
    expect(prepare.mock.calls[0]?.[0]).toEqual(parseDiscoverySourcePreparationArgs(validArgs));
    expect(print).toHaveBeenCalledWith({
      status: "COMMITTED",
      issuance: { contentDigest: "receipt-digest" },
      observation: [{ close: "100.25" }],
    });
  });

  it("prints uncertain commit as nonzero with no fabricated receipt or observation", async () => {
    const print = vi.fn();
    const result = await runDiscoverySourcePreparationBranch(validArgs, {
      cliEnabled: true,
      authorize: vi.fn(),
      prepare: vi.fn().mockResolvedValue({
        status: "COMMIT_UNCERTAIN",
        issuance: null,
        observation: null,
      }),
      print,
    });

    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(print).toHaveBeenCalledWith({
      status: "COMMIT_UNCERTAIN",
      issuance: null,
      observation: null,
    });
  });

  it("leaves ordinary discovery invocations outside the preparation branch", async () => {
    const authorize = vi.fn();
    const prepare = vi.fn();
    const result = await runDiscoverySourcePreparationBranch(
      ["--org-id=org", "--campaign-id=campaign"],
      { cliEnabled: true, authorize, prepare, print: vi.fn() },
    );
    expect(result).toEqual({ handled: false, exitCode: 0 });
    expect(authorize).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });
});
