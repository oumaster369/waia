import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 as ORG } from "@/lib/trader/research/research-development-source-contract-v1";
import type { prepareResearchDevelopmentEvaluationSourcePostgresV1 } from "@/lib/trader/research/research-development-evaluation-source-owner-postgres-v1";
import type { ResearchDevelopmentEvaluationSourceRequestV1 } from "@/lib/trader/research/research-development-evaluation-source-contract-v1";
import { researchDevelopmentEvaluationSourceIdV1 } from "@/lib/trader/research/research-development-evaluation-source-contract-v1";
import {
  parseDiscoveryEvaluationSourceArgs,
  readResearchEvaluationSourceRequestFile,
  runDiscoveryEvaluationSourceBranch,
} from "@/scripts/trader/discovery-evaluation-source";

const digest = (value: string) => value.repeat(64);
const request = () => ({
  organizationId: ORG,
  commandId: "eval-cli:selection-1",
  trainingSourceRunId: `research-source-v1:${digest("a")}`,
  trainingSourceIssuanceDigest: digest("b"),
  symbol: "BTCUSDT" as const,
  validation: { firstRecordIndex: 6, barCount: 6 },
  walkForward: [{ firstRecordIndex: 6, barCount: 2 }, { firstRecordIndex: 10, barCount: 2 }],
});
const args = (requestFile: string) => [
  "--prepare-evaluation-source=1", `--org-id=${ORG}`, `--request-file=${requestFile}`,
];
const evaluationSourceId = researchDevelopmentEvaluationSourceIdV1(request() as ResearchDevelopmentEvaluationSourceRequestV1);
const successfulResult = {
  status: "COMMITTED" as const,
  issuance: {
    metadata: { evaluationSourceId }, contentDigest: digest("d"), rowSetSha256: digest("e"),
  },
} as unknown as Awaited<ReturnType<typeof prepareResearchDevelopmentEvaluationSourcePostgresV1>>;

let directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map(path => rm(path, { recursive: true, force: true })));
  directories = [];
});

async function tempFile(content: string | Buffer) {
  const directory = await mkdtemp(join(tmpdir(), "waia-evaluation-source-"));
  directories.push(directory);
  const path = join(directory, "selection.json");
  await writeFile(path, content);
  return path;
}

describe("discovery evaluation-source preparation CLI", () => {
  it("captures only the separate strict mode and preserves ordinary discovery arguments", () => {
    const path = "/tmp/evaluation-selection.json";
    expect(parseDiscoveryEvaluationSourceArgs(args(path))).toEqual({ organizationId: ORG, requestFile: path });
    expect(parseDiscoveryEvaluationSourceArgs(["--campaign-id=campaign"])).toBeNull();
  });

  it.each([
    ["duplicate flag", [...args("/tmp/selection.json"), `--org-id=${ORG}`]],
    ["unknown flag", [...args("/tmp/selection.json"), "--enable=1"]],
    ["positional argument", [...args("/tmp/selection.json"), "unexpected"]],
    ["training mode mixed in", [...args("/tmp/selection.json"), "--run-issued-training=1"]],
    ["registration mode mixed in", [...args("/tmp/selection.json"), "--register-experiment=1"]],
    ["source preparation mixed in", [...args("/tmp/selection.json"), "--prepare-source=1"]],
    ["campaign mode mixed in", [...args("/tmp/selection.json"), "--campaign-id=campaign"]],
    ["wrong mode value", args("/tmp/selection.json").map(arg => arg.startsWith("--prepare-evaluation-source")
      ? "--prepare-evaluation-source=0" : arg)],
    ["nonabsolute path", args("selection.json")],
    ["missing organization", ["--prepare-evaluation-source=1", "--request-file=/tmp/selection.json"]],
    ["wrong organization", args("/tmp/selection.json").map(arg => arg.startsWith("--org-id=")
      ? "--org-id=11111111-1111-4111-8111-111111111111" : arg)],
  ])("rejects %s before authorization, file read, or issuer access", async (_label, argv) => {
    const authorize = vi.fn();
    const readRequest = vi.fn();
    const prepare = vi.fn();
    const result = await runDiscoveryEvaluationSourceBranch(argv, {
      cliEnabled: true, authorize, readRequest, prepare, print: vi.fn(),
    });
    expect(result).toEqual({ handled: true, exitCode: 1, error: "EVALUATION_SOURCE_ARGUMENTS_INVALID" });
    expect(authorize).not.toHaveBeenCalled();
    expect(readRequest).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("requires CLI posture and operator authorization before reading or preparing", async () => {
    const path = "/private/evaluation-selection.json";
    const readRequest = vi.fn();
    const prepare = vi.fn();
    const disabled = await runDiscoveryEvaluationSourceBranch(args(path), {
      cliEnabled: false, authorize: vi.fn(), readRequest, prepare, print: vi.fn(),
    });
    expect(disabled).toEqual({ handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" });
    const denied = await runDiscoveryEvaluationSourceBranch(args(path), {
      cliEnabled: true, authorize: vi.fn(() => { throw new Error("private operator details"); }),
      readRequest, prepare, print: vi.fn(),
    });
    expect(denied).toEqual({ handled: true, exitCode: 1, error: "EVALUATION_SOURCE_AUTHORIZATION_REQUIRED" });
    expect(readRequest).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(JSON.stringify(denied)).not.toContain("private operator details");
  });

  it("reads only bounded regular UTF-8 selection JSON and enforces its Org", async () => {
    const path = await tempFile(JSON.stringify(request()));
    expect(await readResearchEvaluationSourceRequestFile(path, ORG)).toEqual(request());
    await expect(readResearchEvaluationSourceRequestFile(path, "11111111-1111-4111-8111-111111111111"))
      .rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    await expect(readResearchEvaluationSourceRequestFile(await tempFile(JSON.stringify({
      ...request(), organizationId: "11111111-1111-4111-8111-111111111111",
    })), ORG)).rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    await expect(readResearchEvaluationSourceRequestFile(await tempFile(JSON.stringify({ ...request(), bars: [] })), ORG))
      .rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    await expect(readResearchEvaluationSourceRequestFile(await tempFile(Buffer.from([0xff])), ORG))
      .rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    await expect(readResearchEvaluationSourceRequestFile(await tempFile(" ".repeat(256 * 1024 + 1)), ORG))
      .rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    const directory = await mkdtemp(join(tmpdir(), "waia-evaluation-source-dir-"));
    directories.push(directory);
    await expect(readResearchEvaluationSourceRequestFile(directory, ORG))
      .rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    if (process.platform !== "win32") {
      const fifo = join(directory, "selection.fifo");
      execFileSync("mkfifo", [fifo]);
      await expect(readResearchEvaluationSourceRequestFile(fifo, ORG))
        .rejects.toThrow("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    }
  });

  it("authorizes before reading and prepares a recaptured exact selection", async () => {
    const path = "/private/do-not-print-selection.json";
    const order: string[] = [];
    const print = vi.fn();
    const prepare = vi.fn(async (input: unknown) => {
      order.push("prepare");
      expect(input).toEqual(request());
      return successfulResult;
    });
    const result = await runDiscoveryEvaluationSourceBranch(args(path), {
      cliEnabled: true,
      authorize: () => { order.push("authorize"); },
      readRequest: async requestedPath => {
        order.push("read");
        expect(requestedPath).toBe(path);
        return request();
      },
      prepare,
      print,
    });
    expect(result).toEqual({ handled: true, exitCode: 0 });
    expect(order).toEqual(["authorize", "read", "prepare"]);
    expect(print).toHaveBeenCalledWith({
      status: "COMMITTED", preparationOnly: true, evaluationSourceId,
      trainingSourceRunId: request().trainingSourceRunId,
      trainingSourceIssuanceDigest: digest("b"), contentDigest: digest("d"), rowSetSha256: digest("e"),
      scientificQualified: false, capitalEligible: false,
    });
    const output = JSON.stringify(print.mock.calls);
    expect(output).not.toContain(path);
    expect(output).not.toContain("eval-cli:selection-1");
    expect(output).not.toContain("firstRecordIndex");
    expect(output).not.toContain("bars");
  });

  it("refuses reader-injected invalid selection before owner and redacts owner errors", async () => {
    const prepare = vi.fn();
    const invalidRequest = { ...request(), organizationId: "11111111-1111-4111-8111-111111111111" };
    const invalid = await runDiscoveryEvaluationSourceBranch(args("/private/file.json"), {
      cliEnabled: true, authorize: vi.fn(), readRequest: async () => invalidRequest as never,
      prepare, print: vi.fn(),
    });
    expect(invalid).toEqual({ handled: true, exitCode: 1, error: "EVALUATION_SOURCE_PREPARATION_FAILED" });
    expect(prepare).not.toHaveBeenCalled();

    const ownerError = await runDiscoveryEvaluationSourceBranch(args("/private/file.json"), {
      cliEnabled: true, authorize: vi.fn(), readRequest: async () => request(),
      prepare: vi.fn().mockRejectedValue(new Error("private DB endpoint and secret payload")), print: vi.fn(),
    });
    expect(ownerError).toEqual({ handled: true, exitCode: 1, error: "EVALUATION_SOURCE_PREPARATION_FAILED" });
    expect(JSON.stringify(ownerError)).not.toContain("private DB endpoint");
    expect(JSON.stringify(ownerError)).not.toContain("secret payload");
  });

  it("prints no success receipt when commit confirmation is uncertain and exits nonzero", async () => {
    const print = vi.fn();
    const uncertain = {
      status: "COMMIT_UNCERTAIN" as const,
      issuance: successfulResult.issuance,
    } as unknown as Awaited<ReturnType<typeof prepareResearchDevelopmentEvaluationSourcePostgresV1>>;
    const result = await runDiscoveryEvaluationSourceBranch(args("/private/file.json"), {
      cliEnabled: true, authorize: vi.fn(), readRequest: async () => request(),
      prepare: vi.fn(async () => uncertain), print,
    });
    expect(result).toEqual({ handled: true, exitCode: 1 });
    expect(print).toHaveBeenCalledWith({
      status: "COMMIT_UNCERTAIN", preparationOnly: true,
      evaluationSourceId,
      trainingSourceRunId: request().trainingSourceRunId,
      trainingSourceIssuanceDigest: digest("b"), contentDigest: null, rowSetSha256: null,
      scientificQualified: false, capitalEligible: false,
    });
  });
});
