import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHtrHistoricalCostModelAuthorityV1 } from "@/lib/trader/execution/cost-model";
import {
  RESEARCH_EXECUTABLE_ID_V1,
  RESEARCH_EXPERIMENT_SCHEMA_V1,
  researchExperimentIdentityV1,
} from "@/lib/trader/research/research-experiment-contract-v1";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";
import {
  buildExperimentRegistrationSummary,
  buildIssuedAttemptRegistrationSummary,
  parseDiscoveryExperimentRegistrationArgs,
  parseDiscoveryIssuedAttemptRegistrationArgs,
  readResearchExperimentProposalFile,
  runDiscoveryExperimentRegistrationBranch,
  runDiscoveryIssuedAttemptRegistrationBranch,
} from "@/scripts/trader/discovery-registration";

const attemptId = "a12b3456-7890-4abc-8def-0123456789ab";
const digest = (character: string) => character.repeat(64);
const partition = (contentSha256: string, firstOpenMs: number, lastCloseMs: number) => ({
  contentSha256, firstOpenMs, lastCloseMs, barCount: 10,
});

function validProposal(organizationId: string = RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) {
  const authority = createHtrHistoricalCostModelAuthorityV1();
  return {
    schemaVersion: RESEARCH_EXPERIMENT_SCHEMA_V1,
    organizationId,
    hypothesis: {
      observationEvidenceSha256: [digest("a")], observationCutoffMs: 99,
      mechanism: "A falsifiable mechanism statement.",
      falsificationRule: "Reject if the preregistered condition is absent.",
    },
    executable: {
      id: RESEARCH_EXECUTABLE_ID_V1, sourceSha256: digest("c"),
      featureSemantics: "closed-prefix-sma-population-zscore/v1",
      replaySemantics: "htr-next-eligible-closed-bar-close-with-retained-evaluation-prefix/v1",
    },
    orderedTrials: [{ lookbackBars: 8, buyZscore: "-1.5", sellZscore: "0" }],
    universe: {
      venue: "HTX", market: "SPOT", symbol: "BTCUSDT", interval: "1m",
      pointInTimeEvidenceSha256: digest("d"), knownAtMs: 100,
      datasetSourceSha256: digest("e"), sidecarContentSha256: null,
    },
    partitions: {
      train: partition(digest("1"), 100, 200), validation: partition(digest("2"), 200, 300),
      blind: partition(digest("3"), 300, 400), walkForward: [partition(digest("4"), 210, 240)],
    },
    costs: {
      modelId: authority.modelId, schemaVersion: authority.schemaVersion, feeBps: authority.feeBps,
      halfSpreadBps: authority.halfSpreadBps, marketImpactBps: authority.marketImpactBps,
      slippageModel: authority.slippageModel, takerFeeBps: authority.takerFeeBps,
      makerFeeBps: authority.makerFeeBps, submitLatencyMs: authority.submitLatencyMs,
      cancelLatencyMs: authority.cancelLatencyMs, partialFillModel: authority.partialFillModel,
      costModelDigest: authority.costModelDigest,
    },
    replay: {
      executionMode: "mock", submitResearchMockOrders: true, enableReplayFusedContext: false,
      retentionMode: "FULL", partialRunEvidence: "ineligible", metricsSchemaVersion: "2.0.0",
      defaultQuantity: "0.01", accountKey: "registration-only", portfolio: {
        startingBalanceUsdt: "10000", maxRiskPerTradePct: "1", maxPortfolioRiskPct: "3",
        maxConcurrentPositions: 1, maxNotional: "10000", defaultStopDistancePct: null,
      }, guardian: {
        enabled: false, maxHoldBars: 0, barIntervalMs: 60_000, enableExitEngine: false,
        htrAuthoritative: true, resolvedPolicySha256: digest("8"),
      }, historicalExecutionModelSha256: digest("6"), intelligenceProfileSha256: null,
      volumeQualificationSha256: digest("7"),
    },
    selection: {
      objective: "train-after-cost-realized-pnl", tieBreak: "first-in-declared-family",
      validationSelection: "forbidden", blindSelection: "forbidden",
    },
  };
}

const experimentArgs = (proposalFile: string) => [
  "--register-experiment=1", `--org-id=${RESEARCH_DEVELOPMENT_SOURCE_ORG_V1.toUpperCase()}`,
  `--proposal-file=${proposalFile}`,
];
const attemptArgs = [
  "--register-issued-attempt=1", `--org-id=${RESEARCH_DEVELOPMENT_SOURCE_ORG_V1}`,
  `--spec-sha256=${digest("a")}`, `--source-run-id=research-source-v1:${digest("b")}`,
  "--command-id=discovery-run:attempt-1",
];

let temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.map(path => rm(path, { recursive: true, force: true })));
  temporaryDirectories = [];
});

async function temporaryFile(bytes: string | Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "waia-registration-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "proposal.json");
  await writeFile(path, bytes);
  return path;
}

describe("discovery explicit research registration modes", () => {
  it("captures each mode strictly and leaves ordinary discovery arguments untouched", () => {
    const path = "/tmp/proposal.json";
    expect(parseDiscoveryExperimentRegistrationArgs(experimentArgs(path))).toEqual({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, proposalFile: path,
    });
    expect(parseDiscoveryIssuedAttemptRegistrationArgs(attemptArgs)).toEqual({
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, specSha256: digest("a"),
      sourceRunId: `research-source-v1:${digest("b")}`, commandId: "discovery-run:attempt-1",
    });
    expect(parseDiscoveryExperimentRegistrationArgs(["--campaign-id=campaign"])).toBeNull();
    expect(parseDiscoveryIssuedAttemptRegistrationArgs(["--campaign-id=campaign"])).toBeNull();
  });

  it.each([
    ["duplicate flag", (path: string) => [...experimentArgs(path), "--org-id=" + RESEARCH_DEVELOPMENT_SOURCE_ORG_V1]],
    ["unknown flag", (path: string) => [...experimentArgs(path), "--enable=1"]],
    ["positional argument", (path: string) => [...experimentArgs(path), "unexpected"]],
    ["attempt mode mixed in", (path: string) => [...experimentArgs(path), "--register-issued-attempt=1"]],
    ["source mode mixed in", (path: string) => [...experimentArgs(path), "--prepare-source=1"]],
    ["campaign mode mixed in", (path: string) => [...experimentArgs(path), "--campaign-id=campaign"]],
    ["nonabsolute file", () => ["--register-experiment=1", `--org-id=${RESEARCH_DEVELOPMENT_SOURCE_ORG_V1}`, "--proposal-file=relative.json"]],
  ])("rejects experiment %s before authorization or file access", async (_label, makeArgs) => {
    const authorize = vi.fn();
    const readProposal = vi.fn();
    const register = vi.fn();
    const path = "/tmp/proposal.json";
    const result = await runDiscoveryExperimentRegistrationBranch(makeArgs(path), {
      cliEnabled: true, authorize, readProposal, register, print: vi.fn(),
    });
    expect(result).toEqual({ handled: true, exitCode: 1, error: "EXPERIMENT_REGISTRATION_ARGUMENTS_INVALID" });
    expect(authorize).not.toHaveBeenCalled();
    expect(readProposal).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate flag", [...attemptArgs, `--command-id=second`]],
    ["unknown flag", [...attemptArgs, "--training=1"]],
    ["positional argument", [...attemptArgs, "unexpected"]],
    ["experiment mode mixed in", [...attemptArgs, "--register-experiment=1"]],
    ["training mode mixed in", [...attemptArgs, "--run-issued-training=1"]],
    ["bad hash", attemptArgs.map(arg => arg.startsWith("--spec-sha256=") ? "--spec-sha256=ABC" : arg)],
    ["spec hash trailing newline", attemptArgs.map(arg => arg.startsWith("--spec-sha256=") ? `${arg}\n` : arg)],
    ["source ID trailing newline", attemptArgs.map(arg => arg.startsWith("--source-run-id=") ? `${arg}\n` : arg)],
  ])("rejects issued attempt %s before authorization or owner invocation", async (_label, argv) => {
    const authorize = vi.fn();
    const register = vi.fn();
    const result = await runDiscoveryIssuedAttemptRegistrationBranch(argv, {
      cliEnabled: true, authorize, register, print: vi.fn(),
    });
    expect(result).toEqual({ handled: true, exitCode: 1, error: "ISSUED_ATTEMPT_REGISTRATION_ARGUMENTS_INVALID" });
    expect(authorize).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("requires CLI posture and authorization before file or owner access", async () => {
    const path = "/tmp/proposal.json";
    const readProposal = vi.fn();
    const register = vi.fn();
    const cliDisabled = await runDiscoveryExperimentRegistrationBranch(experimentArgs(path), {
      cliEnabled: false, authorize: vi.fn(), readProposal, register, print: vi.fn(),
    });
    expect(cliDisabled).toEqual({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    const denied = await runDiscoveryExperimentRegistrationBranch(experimentArgs(path), {
      cliEnabled: true,
      authorize: vi.fn(() => { throw new Error("private authorization details"); }),
      readProposal, register, print: vi.fn(),
    });
    expect(denied).toEqual({ handled: true, exitCode: 1, error: "REGISTRATION_AUTHORIZATION_REQUIRED" });
    expect(readProposal).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();

    const attemptRegister = vi.fn();
    const attemptDisabled = await runDiscoveryIssuedAttemptRegistrationBranch(attemptArgs, {
      cliEnabled: false, authorize: vi.fn(), register: attemptRegister, print: vi.fn(),
    });
    expect(attemptDisabled).toEqual({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    const attemptDenied = await runDiscoveryIssuedAttemptRegistrationBranch(attemptArgs, {
      cliEnabled: true,
      authorize: vi.fn(() => { throw new Error("private authorization details"); }),
      register: attemptRegister, print: vi.fn(),
    });
    expect(attemptDenied).toEqual({ handled: true, exitCode: 1, error: "REGISTRATION_AUTHORIZATION_REQUIRED" });
    expect(attemptRegister).not.toHaveBeenCalled();
  });

  it("reads a bounded regular UTF-8 JSON file and normalizes only the registered proposal", async () => {
    const proposal = validProposal();
    const path = await temporaryFile(JSON.stringify(proposal));
    const result = await readResearchExperimentProposalFile(path, RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
    expect(result).toEqual(researchExperimentIdentityV1(proposal).spec);
    await expect(readResearchExperimentProposalFile(path, "f6305dfb-0fec-43cb-ac8a-d6086e17a11f"))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    const wrongOrganizationPath = await temporaryFile(JSON.stringify(validProposal("f6305dfb-0fec-43cb-ac8a-d6086e17a11f")));
    await expect(readResearchExperimentProposalFile(wrongOrganizationPath, RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    const extraFieldProposal = { ...validProposal(), privateUnexpectedField: "refused" };
    await expect(readResearchExperimentProposalFile(await temporaryFile(JSON.stringify(extraFieldProposal)), RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    await expect(readResearchExperimentProposalFile(await temporaryFile(Buffer.from([0xff])), RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    await expect(readResearchExperimentProposalFile(await temporaryFile("{"), RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    await expect(readResearchExperimentProposalFile(await temporaryFile(" ".repeat(256 * 1024 + 1)), RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    const directory = await mkdtemp(join(tmpdir(), "waia-registration-dir-"));
    temporaryDirectories.push(directory);
    await mkdir(join(directory, "subdirectory"));
    await expect(readResearchExperimentProposalFile(join(directory, "subdirectory"), RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
      .rejects.toThrow("PROPOSAL_FILE_INVALID");
    if (process.platform !== "win32") {
      const fifoPath = join(directory, "proposal.fifo");
      execFileSync("mkfifo", [fifoPath]);
      await expect(readResearchExperimentProposalFile(fifoPath, RESEARCH_DEVELOPMENT_SOURCE_ORG_V1))
        .rejects.toThrow("PROPOSAL_FILE_INVALID");
    }
  });

  it("authorizes before reading and calls only the registration owner with normalized proposal", async () => {
    const proposal = researchExperimentIdentityV1(validProposal()).spec;
    const path = "/private/source-path-do-not-print.json";
    const order: string[] = [];
    const print = vi.fn();
    const registerResult = {
      authority: "REGISTRATION_ONLY" as const,
      specSha256: digest("c"), spec: proposal, declaredFamilySize: 1, registeredAt: "2026-10-04T00:00:00.000Z",
    };
    const result = await runDiscoveryExperimentRegistrationBranch(experimentArgs(path), {
      cliEnabled: true,
      authorize: vi.fn(() => { order.push("authorize"); }),
      readProposal: vi.fn(async requestedPath => {
        order.push("read"); expect(requestedPath).toBe(path); return proposal;
      }),
      register: vi.fn(async (organizationId, input) => {
        order.push("register"); expect(organizationId).toBe(RESEARCH_DEVELOPMENT_SOURCE_ORG_V1);
        expect(input).toEqual(proposal); return registerResult;
      }),
      print,
    });
    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(order).toEqual(["authorize", "read", "register"]);
    expect(print).toHaveBeenCalledWith({
      status: "CONFIRMED", authority: "REGISTRATION_ONLY",
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, specSha256: digest("c"),
      registrationOnly: true, scientificQualified: false, capitalEligible: false,
    });
    expect(JSON.stringify(print.mock.calls)).not.toContain(path);
    expect(JSON.stringify(print.mock.calls)).not.toContain("mechanism");
  });

  it("prints only the confirmed issued-attempt identity and never fabricates success", async () => {
    const print = vi.fn();
    const register = vi.fn(async () => ({
      schemaVersion: "waia.research.issued-attempt.v2" as const,
      authority: "ISSUED_SOURCE_BINDING_ONLY" as const,
      id: attemptId, organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      specSha256: digest("a"), sourceRunId: `research-source-v1:${digest("b")}`,
      sourceIssuanceDigest: digest("c"), commandId: "hidden-command", scientificallyQualified: false as const,
      capitalEligible: false as const,
    }));
    const result = await runDiscoveryIssuedAttemptRegistrationBranch(attemptArgs, {
      cliEnabled: true, authorize: vi.fn(), register, print,
    });
    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(register).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledWith({
      status: "CONFIRMED", authority: "REGISTRATION_ONLY", organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1,
      attemptId, specSha256: digest("a"), sourceRunId: `research-source-v1:${digest("b")}`,
      sourceIssuanceDigest: digest("c"), registrationOnly: true, scientificQualified: false, capitalEligible: false,
    });

    const rejectedPrint = vi.fn();
    const rejected = await runDiscoveryIssuedAttemptRegistrationBranch(attemptArgs, {
      cliEnabled: true, authorize: vi.fn(), register: vi.fn().mockRejectedValue(new Error("secret DB details")),
      print: rejectedPrint,
    });
    expect(rejected).toEqual({ handled: true, exitCode: 1, error: "ISSUED_ATTEMPT_REGISTRATION_FAILED" });
    expect(rejectedPrint).not.toHaveBeenCalled();
    expect(JSON.stringify(rejected)).not.toContain("secret DB details");
  });

  it("hides experiment proposal and owner errors without printing a success summary", async () => {
    const path = "/private/proposal-with-secret-name.json";
    const print = vi.fn();
    const readFailure = await runDiscoveryExperimentRegistrationBranch(experimentArgs(path), {
      cliEnabled: true, authorize: vi.fn(),
      readProposal: vi.fn().mockRejectedValue(new Error(`cannot read ${path} with private payload`)),
      register: vi.fn(), print,
    });
    expect(readFailure).toEqual({ handled: true, exitCode: 1, error: "EXPERIMENT_REGISTRATION_FAILED" });
    expect(print).not.toHaveBeenCalled();
    expect(JSON.stringify(readFailure)).not.toContain(path);
    const ownerFailure = await runDiscoveryExperimentRegistrationBranch(experimentArgs(path), {
      cliEnabled: true, authorize: vi.fn(),
      readProposal: vi.fn(async () => researchExperimentIdentityV1(validProposal()).spec),
      register: vi.fn().mockRejectedValue(new Error("private DB failure")), print,
    });
    expect(ownerFailure).toEqual({ handled: true, exitCode: 1, error: "EXPERIMENT_REGISTRATION_FAILED" });
    expect(print).not.toHaveBeenCalled();
    expect(JSON.stringify(ownerFailure)).not.toContain("private DB failure");
  });

  it("keeps old discovery calls outside both registration modes", async () => {
    const authorize = vi.fn();
    const result = await runDiscoveryExperimentRegistrationBranch(["--org-id=org", "--campaign-id=campaign"], {
      cliEnabled: true, authorize, readProposal: vi.fn(), register: vi.fn(), print: vi.fn(),
    });
    const attempt = await runDiscoveryIssuedAttemptRegistrationBranch(["--org-id=org", "--campaign-id=campaign"], {
      cliEnabled: true, authorize, register: vi.fn(), print: vi.fn(),
    });
    expect(result).toEqual({ handled: false, exitCode: 0 });
    expect(attempt).toEqual({ handled: false, exitCode: 0 });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("exposes summaries as narrow registration receipts", () => {
    const proposal = researchExperimentIdentityV1(validProposal()).spec;
    expect(buildExperimentRegistrationSummary({
      authority: "REGISTRATION_ONLY", specSha256: digest("d"), spec: proposal,
      declaredFamilySize: 1, registeredAt: "2026-10-04T00:00:00.000Z",
    })).toEqual({ status: "CONFIRMED", authority: "REGISTRATION_ONLY",
      organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, specSha256: digest("d"),
      registrationOnly: true, scientificQualified: false, capitalEligible: false });
    expect(buildIssuedAttemptRegistrationSummary({
      schemaVersion: "waia.research.issued-attempt.v2", authority: "ISSUED_SOURCE_BINDING_ONLY",
      id: attemptId, organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, specSha256: digest("a"),
      sourceRunId: `research-source-v1:${digest("b")}`, sourceIssuanceDigest: digest("c"),
      commandId: "private", scientificallyQualified: false, capitalEligible: false,
    })).not.toHaveProperty("commandId");
  });
});
