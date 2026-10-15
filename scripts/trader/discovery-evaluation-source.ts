import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { TextDecoder } from "node:util";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";
import {
  captureResearchDevelopmentEvaluationSourceRequestV1,
  researchDevelopmentEvaluationSourceIdV1,
  type ResearchDevelopmentEvaluationSourceRequestV1,
} from "@/lib/trader/research/research-development-evaluation-source-contract-v1";
import type { prepareResearchDevelopmentEvaluationSourcePostgresV1 } from "@/lib/trader/research/research-development-evaluation-source-owner-postgres-v1";

const MAX_REQUEST_BYTES = 256 * 1024;
const FLAGS = new Set(["prepare-evaluation-source", "org-id", "request-file"]);

type Owner = typeof prepareResearchDevelopmentEvaluationSourcePostgresV1;
type Result = Awaited<ReturnType<Owner>>;
type BranchResult = Readonly<{ handled: boolean; exitCode: number; error?: string }>;

function hasFlag(argv: readonly string[]): boolean {
  return argv.some(arg => arg === "--prepare-evaluation-source" || arg.startsWith("--prepare-evaluation-source="));
}

function captureOrgId(value: string | undefined): typeof RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 {
  if (value?.toLowerCase() !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) {
    throw new Error("EVALUATION_SOURCE_ARGUMENTS_INVALID");
  }
  return RESEARCH_DEVELOPMENT_SOURCE_ORG_V1;
}

export function parseDiscoveryEvaluationSourceArgs(argv: readonly string[]) {
  if (!hasFlag(argv)) return null;
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error("EVALUATION_SOURCE_ARGUMENTS_INVALID");
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals <= 0) throw new Error("EVALUATION_SOURCE_ARGUMENTS_INVALID");
    const name = body.slice(0, equals);
    const value = body.slice(equals + 1);
    if (!FLAGS.has(name) || values.has(name) || !value) {
      throw new Error("EVALUATION_SOURCE_ARGUMENTS_INVALID");
    }
    values.set(name, value);
  }
  const requestFile = values.get("request-file");
  if (values.get("prepare-evaluation-source") !== "1" || !requestFile || !isAbsolute(requestFile)) {
    throw new Error("EVALUATION_SOURCE_ARGUMENTS_INVALID");
  }
  return Object.freeze({ organizationId: captureOrgId(values.get("org-id")), requestFile });
}

/** Reads only bounded JSON metadata. The resulting strict contract has no market payload fields. */
export async function readResearchEvaluationSourceRequestFile(
  requestFile: string,
  organizationId: string,
): Promise<ResearchDevelopmentEvaluationSourceRequestV1> {
  if (!isAbsolute(requestFile) || organizationId.toLowerCase() !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) {
    throw new Error("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(requestFile, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES) throw new Error("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    const buffer = Buffer.allocUnsafe(MAX_REQUEST_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_REQUEST_BYTES) throw new Error("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    const request = captureResearchDevelopmentEvaluationSourceRequestV1(JSON.parse(text));
    if (request.organizationId !== organizationId.toLowerCase()) {
      throw new Error("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
    }
    return request;
  } catch {
    throw new Error("EVALUATION_SOURCE_REQUEST_FILE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export function buildEvaluationSourceCliSummary(request: ResearchDevelopmentEvaluationSourceRequestV1, result: Result) {
  const issuance = result.status === "COMMIT_UNCERTAIN" ? null : result.issuance;
  return Object.freeze({
    status: result.status,
    preparationOnly: true as const,
    evaluationSourceId: issuance?.metadata.evaluationSourceId ?? researchDevelopmentEvaluationSourceIdV1(request),
    trainingSourceRunId: request.trainingSourceRunId,
    trainingSourceIssuanceDigest: request.trainingSourceIssuanceDigest,
    contentDigest: issuance?.contentDigest ?? null,
    rowSetSha256: issuance?.rowSetSha256 ?? null,
    scientificQualified: false as const,
    capitalEligible: false as const,
  });
}

export async function runDiscoveryEvaluationSourceBranch(
  argv: readonly string[],
  input: {
    cliEnabled: boolean;
    authorize(): void;
    readRequest(path: string, organizationId: string): Promise<ResearchDevelopmentEvaluationSourceRequestV1>;
    prepare: Owner;
    print(value: ReturnType<typeof buildEvaluationSourceCliSummary>): void;
  },
): Promise<BranchResult> {
  if (!hasFlag(argv)) return { handled: false, exitCode: 0 };
  if (!input.cliEnabled) return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  let args: NonNullable<ReturnType<typeof parseDiscoveryEvaluationSourceArgs>>;
  try {
    args = parseDiscoveryEvaluationSourceArgs(argv)!;
  } catch {
    return { handled: true, exitCode: 1, error: "EVALUATION_SOURCE_ARGUMENTS_INVALID" };
  }
  try {
    input.authorize();
  } catch {
    return { handled: true, exitCode: 1, error: "EVALUATION_SOURCE_AUTHORIZATION_REQUIRED" };
  }
  try {
    const request = captureResearchDevelopmentEvaluationSourceRequestV1(
      await input.readRequest(args.requestFile, args.organizationId),
    );
    if (request.organizationId !== args.organizationId) {
      return { handled: true, exitCode: 1, error: "EVALUATION_SOURCE_REQUEST_ORG_MISMATCH" };
    }
    const result = await input.prepare(request);
    input.print(buildEvaluationSourceCliSummary(request, result));
    return { handled: true, exitCode: result.status === "COMMIT_UNCERTAIN" ? 1 : 0 };
  } catch {
    return { handled: true, exitCode: 1, error: "EVALUATION_SOURCE_PREPARATION_FAILED" };
  }
}
