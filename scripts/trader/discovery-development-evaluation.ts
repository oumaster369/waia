import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { TextDecoder } from "node:util";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";
import { captureResearchDevelopmentEvaluationClaimRequestV1,
  type ResearchDevelopmentEvaluationClaimRequestV1 } from "@/lib/trader/research/research-development-evaluation-claim-contract-v1";
import type { reserveResearchDevelopmentEvaluationPostgresV1,
  runResearchDevelopmentEvaluationPostgresV1 } from "@/lib/trader/research/research-issued-training-diagnostic-postgres-v2";

const MAX_REQUEST_BYTES = 256 * 1024;
const MODES = ["reserve-development-evaluation", "run-development-evaluation"] as const;
const FLAGS = new Set<string>([...MODES, "org-id", "request-file"]);
type Reserve = typeof reserveResearchDevelopmentEvaluationPostgresV1;
type Evaluate = typeof runResearchDevelopmentEvaluationPostgresV1;
type Action = "RESERVE" | "EVALUATE";
type OwnerResult = Awaited<ReturnType<Reserve | Evaluate>>;
type BranchResult = Readonly<{ handled: boolean; exitCode: number; error?: string }>;

export function hasDiscoveryDevelopmentEvaluationFlag(argv: readonly string[]) {
  return argv.some(arg => MODES.some(mode => arg === `--${mode}` || arg.startsWith(`--${mode}=`)));
}

export function parseDiscoveryDevelopmentEvaluationArgs(argv: readonly string[]) {
  if (!hasDiscoveryDevelopmentEvaluationFlag(argv)) return null;
  const refuse = () => { throw new Error("DEVELOPMENT_EVALUATION_ARGUMENTS_INVALID"); };
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) refuse();
    const equals = arg.indexOf("=");
    if (equals <= 2) refuse();
    const name = arg.slice(2, equals);
    const value = arg.slice(equals + 1);
    if (!FLAGS.has(name) || values.has(name) || !value) refuse();
    values.set(name, value);
  }
  const selected = MODES.filter(mode => values.has(mode));
  const requestFile = values.get("request-file");
  if (selected.length !== 1 || values.get(selected[0]!) !== "1" || !requestFile || !isAbsolute(requestFile) ||
      values.get("org-id")?.toLowerCase() !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) refuse();
  return Object.freeze({ action: selected[0] === MODES[0] ? "RESERVE" as const : "EVALUATE" as const,
    organizationId: RESEARCH_DEVELOPMENT_SOURCE_ORG_V1, requestFile: requestFile! });
}

/** IDs and operational budgets only, read from a bounded regular UTF-8 file. */
export async function readResearchDevelopmentEvaluationRequestFile(requestFile: string,
  organizationId: string): Promise<ResearchDevelopmentEvaluationClaimRequestV1> {
  const error = () => new Error("DEVELOPMENT_EVALUATION_REQUEST_FILE_INVALID");
  if (!isAbsolute(requestFile) || organizationId.toLowerCase() !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) throw error();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(requestFile, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_REQUEST_BYTES) throw error();
    const buffer = Buffer.allocUnsafe(MAX_REQUEST_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > MAX_REQUEST_BYTES) throw error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    const request = captureResearchDevelopmentEvaluationClaimRequestV1(JSON.parse(text));
    if (request.organizationId !== organizationId.toLowerCase()) throw error();
    return request;
  } catch { throw error(); }
  finally { await handle?.close().catch(() => undefined); }
}

export function buildDevelopmentEvaluationCliSummary(action: Action, result: OwnerResult) {
  if (!["COMMITTED", "REPLAYED", "CONFIRMED_AFTER_UNCERTAINTY", "COMMIT_UNCERTAIN"].includes(result.status)) {
    throw new Error("DEVELOPMENT_EVALUATION_FAILED");
  }
  // An unconfirmed candidate receipt never becomes console evidence of success.
  const receipt = result.status === "COMMIT_UNCERTAIN" ? null : result.receipt;
  if (result.status !== "COMMIT_UNCERTAIN" && !receipt) throw new Error("DEVELOPMENT_EVALUATION_FAILED");
  const evaluation = receipt && "stages" in receipt ? receipt : null;
  if (receipt && ((action === "EVALUATE") !== Boolean(evaluation))) throw new Error("DEVELOPMENT_EVALUATION_FAILED");
  return Object.freeze({ action, status: result.status, claimId: receipt?.claimId ?? null,
    claimDigest: receipt ? (evaluation ? evaluation.claimDigest : receipt.contentDigest) : null,
    receiptDigest: receipt?.contentDigest ?? null, stageCount: receipt ? (evaluation?.stages.length ?? 0) : null,
    scientificQualified: false as const, capitalEligible: false as const });
}

export async function runDiscoveryDevelopmentEvaluationBranch(argv: readonly string[], input: {
  cliEnabled: boolean; authorize(): void | Promise<void>;
  readRequest(path: string, organizationId: string): Promise<ResearchDevelopmentEvaluationClaimRequestV1>;
  reserve: Reserve; evaluate: Evaluate;
  print(summary: ReturnType<typeof buildDevelopmentEvaluationCliSummary>): void;
}): Promise<BranchResult> {
  if (!hasDiscoveryDevelopmentEvaluationFlag(argv)) return { handled: false, exitCode: 0 };
  if (!input.cliEnabled) return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  let args: NonNullable<ReturnType<typeof parseDiscoveryDevelopmentEvaluationArgs>>;
  try { args = parseDiscoveryDevelopmentEvaluationArgs(argv)!; }
  catch { return { handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_ARGUMENTS_INVALID" }; }
  try { await input.authorize(); }
  catch { return { handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_AUTHORIZATION_REQUIRED" }; }
  try {
    const request = captureResearchDevelopmentEvaluationClaimRequestV1(await input.readRequest(args.requestFile, args.organizationId));
    if (request.organizationId !== args.organizationId) throw new Error("DEVELOPMENT_EVALUATION_FAILED");
    const result = await (args.action === "RESERVE" ? input.reserve(request) : input.evaluate(request));
    input.print(buildDevelopmentEvaluationCliSummary(args.action, result));
    return { handled: true, exitCode: result.status === "COMMIT_UNCERTAIN" ? 1 : 0 };
  } catch { return { handled: true, exitCode: 1, error: "DEVELOPMENT_EVALUATION_FAILED" }; }
}
