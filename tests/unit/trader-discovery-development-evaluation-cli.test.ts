import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import type { ResearchDevelopmentEvaluationClaimRequestV1 } from "@/lib/trader/research/research-development-evaluation-claim-contract-v1";
import type { reserveResearchDevelopmentEvaluationPostgresV1,
  runResearchDevelopmentEvaluationPostgresV1 } from "@/lib/trader/research/research-issued-training-diagnostic-postgres-v2";
import {
  parseDiscoveryDevelopmentEvaluationArgs,
  readResearchDevelopmentEvaluationRequestFile,
  runDiscoveryDevelopmentEvaluationBranch,
} from "@/scripts/trader/discovery-development-evaluation";

const digest = (character: string) => character.repeat(64);
const request = (): ResearchDevelopmentEvaluationClaimRequestV1 => ({
  organizationId: ORG,
  attemptId: "8c72a658-123d-4f35-bb09-174a3f7fc793",
  evaluationSourceId: `research-evaluation-source-v1:${digest("a")}`,
  commandId: "eval-cli:request-1",
  limits: { maxBars: 64, maxBytes: 2_000_000, maxTraceBytes: 2_000_000 },
});
const argv = (action: "RESERVE" | "EVALUATE", requestFile = "/tmp/evaluation-request.json") => [
  action === "RESERVE" ? "--reserve-development-evaluation=1" : "--run-development-evaluation=1",
  `--org-id=${ORG}`, `--request-file=${requestFile}`,
];
const claimResult = (status: "COMMITTED" | "REPLAYED" = "COMMITTED") => ({
  status,
  receipt: { claimId: "08c85c0e-0b84-4871-a0a2-08ff9ed4fa11", contentDigest: digest("b") },
}) as unknown as Awaited<ReturnType<typeof reserveResearchDevelopmentEvaluationPostgresV1>>;
const evaluationResult = (status: "COMMITTED" | "REPLAYED" = "COMMITTED") => ({
  status,
  receipt: { claimId: "08c85c0e-0b84-4871-a0a2-08ff9ed4fa11", claimDigest: digest("b"),
    contentDigest: digest("c"), stages: [{ stageOrdinal: 0 }, { stageOrdinal: 1 }] },
}) as unknown as Awaited<ReturnType<typeof runResearchDevelopmentEvaluationPostgresV1>>;

let directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map(path => rm(path, { recursive: true, force: true })));
  directories = [];
});

async function tempFile(content: string | Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "waia-development-evaluation-cli-"));
  directories.push(directory);
  const path = join(directory, "request.json");
  await writeFile(path, content);
  return path;
}

describe("discovery DEVELOPMENT evaluation operator CLI", () => {
  it("recognizes only the two separate modes and leaves ordinary invocations unhandled", async () => {
    expect(parseDiscoveryDevelopmentEvaluationArgs(argv("RESERVE"))).toEqual({
      action: "RESERVE", organizationId: ORG, requestFile: "/tmp/evaluation-request.json",
    });
    expect(parseDiscoveryDevelopmentEvaluationArgs(argv("EVALUATE"))).toEqual({
      action: "EVALUATE", organizationId: ORG, requestFile: "/tmp/evaluation-request.json",
    });
    expect(parseDiscoveryDevelopmentEvaluationArgs(["--campaign-id=campaign"])).toBeNull();
    const authorize = vi.fn();
    const result = await runDiscoveryDevelopmentEvaluationBranch(["--campaign-id=campaign"], {
      cliEnabled: true, authorize, readRequest: vi.fn(), reserve: vi.fn() as never,
      evaluate: vi.fn() as never, print: vi.fn(),
    });
    expect(result).toEqual({ handled: false, exitCode: 0 });
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each([
    ["duplicate mode", [...argv("RESERVE"), "--reserve-development-evaluation=1"]],
    ["mixed modes", [...argv("RESERVE"), "--run-development-evaluation=1"]],
    ["unknown flag", [...argv("RESERVE"), "--enable=1"]],
    ["positional argument", [...argv("RESERVE"), "unexpected"]],
    ["wrong mode value", argv("RESERVE").map(value => value.startsWith("--reserve-")
      ? "--reserve-development-evaluation=0" : value)],
    ["mode without value", argv("RESERVE").map(value => value.startsWith("--reserve-")
      ? "--reserve-development-evaluation" : value)],
    ["relative request path", argv("RESERVE", "request.json")],
    ["missing organization", ["--reserve-development-evaluation=1", "--request-file=/tmp/request.json"]],
    ["wrong organization", argv("RESERVE").map(value => value.startsWith("--org-id=")
      ? "--org-id=11111111-1111-4111-8111-111111111111" : value)],
  ])("rejects %s before authorization, file reads, or owner calls", async (_label, input) => {
    const authorize = vi.fn();
    const readRequest = vi.fn();
    const reserve = vi.fn();
    const evaluate = vi.fn();
    const result = await runDiscoveryDevelopmentEvaluationBranch(input, {
      cliEnabled: true, authorize, readRequest, reserve: reserve as never,
      evaluate: evaluate as never, print: vi.fn(),
    });
    expect(result).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_ARGUMENTS_INVALID" });
    expect(authorize).not.toHaveBeenCalled();
    expect(readRequest).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("requires CLI posture and operator authorization before file or owner access", async () => {
    const readRequest = vi.fn();
    const reserve = vi.fn();
    const evaluate = vi.fn();
    const disabled = await runDiscoveryDevelopmentEvaluationBranch(argv("RESERVE"), {
      cliEnabled: false, authorize: vi.fn(), readRequest, reserve: reserve as never,
      evaluate: evaluate as never, print: vi.fn(),
    });
    expect(disabled).toEqual({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    const denied = await runDiscoveryDevelopmentEvaluationBranch(argv("EVALUATE"), {
      cliEnabled: true, authorize: vi.fn(() => { throw new Error("private operator detail"); }), readRequest,
      reserve: reserve as never, evaluate: evaluate as never, print: vi.fn(),
    });
    expect(denied).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_AUTHORIZATION_REQUIRED" });
    expect(readRequest).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(denied)).not.toContain("private operator detail");

    const deniedAsync = await runDiscoveryDevelopmentEvaluationBranch(argv("EVALUATE"), {
      cliEnabled: true, authorize: async () => { throw new Error("private async authorization detail"); },
      readRequest, reserve: reserve as never, evaluate: evaluate as never, print: vi.fn(),
    });
    expect(deniedAsync).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_AUTHORIZATION_REQUIRED" });
    expect(readRequest).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
    expect(JSON.stringify(deniedAsync)).not.toContain("private async authorization detail");

    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const deferredRead = vi.fn(async () => request());
    const pending = runDiscoveryDevelopmentEvaluationBranch(argv("RESERVE"), {
      cliEnabled: true, authorize: () => gate, readRequest: deferredRead,
      reserve: vi.fn(async () => claimResult()) as never, evaluate: vi.fn() as never, print: vi.fn(),
    });
    await Promise.resolve();
    expect(deferredRead).not.toHaveBeenCalled();
    release();
    expect(await pending).toEqual({ handled: true, exitCode: 0 });
    expect(deferredRead).toHaveBeenCalledTimes(1);
  });

  it("reads bounded regular UTF-8 request JSON and captures only the closed contract", async () => {
    const path = await tempFile(JSON.stringify(request()));
    expect(await readResearchDevelopmentEvaluationRequestFile(path, ORG)).toEqual(request());
    await expect(readResearchDevelopmentEvaluationRequestFile(path, "11111111-1111-4111-8111-111111111111"))
      .rejects.toThrow("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
    await expect(readResearchDevelopmentEvaluationRequestFile(await tempFile(JSON.stringify({ ...request(), bars: [] })), ORG))
      .rejects.toThrow("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
    await expect(readResearchDevelopmentEvaluationRequestFile(await tempFile(Buffer.from([0xff])), ORG))
      .rejects.toThrow("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
    await expect(readResearchDevelopmentEvaluationRequestFile(await tempFile(" ".repeat(256 * 1024 + 1)), ORG))
      .rejects.toThrow("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
    const directory = await mkdtemp(join(tmpdir(), "waia-development-evaluation-dir-"));
    directories.push(directory);
    await expect(readResearchDevelopmentEvaluationRequestFile(directory, ORG))
      .rejects.toThrow("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
    if (process.platform !== "win32") {
      const fifo = join(directory, "request.fifo");
      execFileSync("mkfifo", [fifo]);
      await expect(readResearchDevelopmentEvaluationRequestFile(fifo, ORG))
        .rejects.toThrow("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
    }
  });

  it("uses an argument snapshot and calls only the selected owner", async () => {
    for (const action of ["RESERVE", "EVALUATE"] as const) {
      const inputArgs = argv(action, "/private/request-file.json");
      const order: string[] = [];
      const print = vi.fn();
      const reserve = vi.fn(async () => { order.push("reserve"); return claimResult(); });
      const evaluate = vi.fn(async () => { order.push("evaluate"); return evaluationResult(); });
      const result = await runDiscoveryDevelopmentEvaluationBranch(inputArgs, {
        cliEnabled: true,
        authorize: () => { order.push("authorize"); inputArgs[2] = "--request-file=/mutated.json"; },
        readRequest: async (path, org) => { order.push("read"); expect(path).toBe("/private/request-file.json"); expect(org).toBe(ORG); return request(); },
        reserve: reserve as never, evaluate: evaluate as never, print,
      });
      expect(result).toEqual({ handled: true, exitCode: 0 });
      expect(order).toEqual(["authorize", "read", action === "RESERVE" ? "reserve" : "evaluate"]);
      expect(reserve).toHaveBeenCalledTimes(action === "RESERVE" ? 1 : 0);
      expect(evaluate).toHaveBeenCalledTimes(action === "EVALUATE" ? 1 : 0);
      expect(print).toHaveBeenCalledWith(action === "RESERVE" ? {
        action, status: "COMMITTED", claimId: "08c85c0e-0b84-4871-a0a2-08ff9ed4fa11",
        claimDigest: digest("b"), receiptDigest: digest("b"), stageCount: 0,
        scientificQualified: false, capitalEligible: false,
      } : {
        action, status: "COMMITTED", claimId: "08c85c0e-0b84-4871-a0a2-08ff9ed4fa11",
        claimDigest: digest("b"), receiptDigest: digest("c"), stageCount: 2,
        scientificQualified: false, capitalEligible: false,
      });
      expect(JSON.stringify(print.mock.calls)).not.toContain("/private/request-file.json");
      expect(JSON.stringify(print.mock.calls)).not.toContain("selectedParameters");
    }
  });

  it("rejects reader-injected mismatches and redacts file or owner failures", async () => {
    const reserve = vi.fn();
    const evaluate = vi.fn();
    const mismatch = await runDiscoveryDevelopmentEvaluationBranch(argv("RESERVE"), {
      cliEnabled: true, authorize: vi.fn(),
      readRequest: async () => ({ ...request(), organizationId: "11111111-1111-4111-8111-111111111111" } as never),
      reserve: reserve as never, evaluate: evaluate as never, print: vi.fn(),
    });
    expect(mismatch).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_FAILED" });
    expect(reserve).not.toHaveBeenCalled();
    const injected = await runDiscoveryDevelopmentEvaluationBranch(argv("RESERVE"), {
      cliEnabled: true, authorize: vi.fn(),
      readRequest: async () => ({ ...request(), bars: [{ close: "100" }] } as never),
      reserve: reserve as never, evaluate: evaluate as never, print: vi.fn(),
    });
    expect(injected).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_FAILED" });
    expect(reserve).not.toHaveBeenCalled();
    const fileFailure = await runDiscoveryDevelopmentEvaluationBranch(argv("RESERVE"), {
      cliEnabled: true, authorize: vi.fn(),
      readRequest: vi.fn().mockRejectedValue(new Error("private filename and malformed bytes")),
      reserve: reserve as never, evaluate: evaluate as never, print: vi.fn(),
    });
    expect(fileFailure).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_FAILED" });
    expect(JSON.stringify(fileFailure)).not.toContain("private filename");
    const failure = await runDiscoveryDevelopmentEvaluationBranch(argv("EVALUATE"), {
      cliEnabled: true, authorize: vi.fn(), readRequest: async () => request(), reserve: reserve as never,
      evaluate: vi.fn().mockRejectedValue(new Error("private DB host and payload")) as never, print: vi.fn(),
    });
    expect(failure).toEqual({ handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_FAILED" });
    expect(JSON.stringify(failure)).not.toContain("private DB host");
    expect(JSON.stringify(failure)).not.toContain("payload");
  });

  it("suppresses every candidate identifier when the owner reports uncertain commit", async () => {
    const print = vi.fn();
    const poisoned = { status: "COMMIT_UNCERTAIN", receipt: {
      claimId: "08c85c0e-0b84-4871-a0a2-08ff9ed4fa11", contentDigest: digest("b"),
      claimDigest: digest("b"), stages: [{ secret: "must not print" }],
    } } as unknown as Awaited<ReturnType<typeof runResearchDevelopmentEvaluationPostgresV1>>;
    const result = await runDiscoveryDevelopmentEvaluationBranch(argv("EVALUATE"), {
      cliEnabled: true, authorize: vi.fn(), readRequest: async () => request(), reserve: vi.fn() as never,
      evaluate: vi.fn(async () => poisoned) as never, print,
    });
    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(print).toHaveBeenCalledWith({ action: "EVALUATE", status: "COMMIT_UNCERTAIN",
      claimId: null, claimDigest: null, receiptDigest: null, stageCount: null,
      scientificQualified: false, capitalEligible: false });
    expect(JSON.stringify(print.mock.calls)).not.toContain("secret");
    expect(JSON.stringify(print.mock.calls)).not.toContain("08c85c0e");
  });
});
