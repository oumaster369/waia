import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { TextDecoder } from "node:util";
import { RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 } from "@/lib/trader/research/research-development-source-contract-v1";
import { researchExperimentIdentityV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import type { ResearchExperimentSpecV1 } from "@/lib/trader/research/research-experiment-contract-v1";
import type { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import type { registerResearchIssuedAttemptPostgresV2 } from "@/lib/trader/research/research-issued-attempt-postgres-v2";

const MAX_PROPOSAL_BYTES = 256 * 1024;
const SHA256 = /^[a-f0-9]{64}(?![\s\S])/;
const SOURCE_RUN_ID = /^research-source-v1:[a-f0-9]{64}(?![\s\S])/;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}(?![\s\S])/;

type ExperimentRegistrationRequest = Readonly<{
  organizationId: typeof RESEARCH_DEVELOPMENT_SOURCE_ORG_V1;
  proposalFile: string;
}>;

type IssuedAttemptRegistrationRequest = Readonly<{
  organizationId: typeof RESEARCH_DEVELOPMENT_SOURCE_ORG_V1;
  specSha256: string;
  sourceRunId: string;
  commandId: string;
}>;

function registrationFlags(argv: readonly string[], mode: string, allowed: ReadonlySet<string>) {
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error("REGISTRATION_ARGUMENTS_INVALID");
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals <= 0) throw new Error("REGISTRATION_ARGUMENTS_INVALID");
    const name = body.slice(0, equals);
    const value = body.slice(equals + 1);
    if (!allowed.has(name) || seen.has(name) || value.length === 0) {
      throw new Error("REGISTRATION_ARGUMENTS_INVALID");
    }
    seen.add(name);
    values.set(name, value);
  }
  if (values.get(mode) !== "1") throw new Error("REGISTRATION_ARGUMENTS_INVALID");
  return values;
}

function captureOrganization(value: string | undefined): typeof RESEARCH_DEVELOPMENT_SOURCE_ORG_V1 {
  if (value?.toLowerCase() !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) {
    throw new Error("REGISTRATION_ARGUMENTS_INVALID");
  }
  return RESEARCH_DEVELOPMENT_SOURCE_ORG_V1;
}

const EXPERIMENT_FLAGS = new Set(["register-experiment", "org-id", "proposal-file"]);

export function parseDiscoveryExperimentRegistrationArgs(argv: readonly string[]) {
  if (!argv.some(arg => arg === "--register-experiment" || arg.startsWith("--register-experiment="))) {
    return null;
  }
  const values = registrationFlags(argv, "register-experiment", EXPERIMENT_FLAGS);
  const proposalFile = values.get("proposal-file");
  if (!proposalFile || !isAbsolute(proposalFile)) throw new Error("REGISTRATION_ARGUMENTS_INVALID");
  return Object.freeze({
    organizationId: captureOrganization(values.get("org-id")),
    proposalFile,
  });
}

const ISSUED_ATTEMPT_FLAGS = new Set([
  "register-issued-attempt", "org-id", "spec-sha256", "source-run-id", "command-id",
]);

export function parseDiscoveryIssuedAttemptRegistrationArgs(argv: readonly string[]) {
  if (!argv.some(arg => arg === "--register-issued-attempt" || arg.startsWith("--register-issued-attempt="))) {
    return null;
  }
  const values = registrationFlags(argv, "register-issued-attempt", ISSUED_ATTEMPT_FLAGS);
  const specSha256 = values.get("spec-sha256");
  const sourceRunId = values.get("source-run-id");
  const commandId = values.get("command-id");
  if (!specSha256 || !SHA256.test(specSha256) || !sourceRunId || !SOURCE_RUN_ID.test(sourceRunId) ||
      !commandId || !COMMAND_ID.test(commandId)) {
    throw new Error("REGISTRATION_ARGUMENTS_INVALID");
  }
  return Object.freeze({
    organizationId: captureOrganization(values.get("org-id")),
    specSha256,
    sourceRunId,
    commandId,
  });
}

/** Read and normalize a proposal without writing any registration state. */
export async function readResearchExperimentProposalFile(
  proposalFile: string,
  organizationId: string,
): Promise<ResearchExperimentSpecV1> {
  if (!isAbsolute(proposalFile) || organizationId.toLowerCase() !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) {
    throw new Error("PROPOSAL_FILE_INVALID");
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(proposalFile, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_PROPOSAL_BYTES) throw new Error("PROPOSAL_FILE_INVALID");
    const buffer = Buffer.allocUnsafe(MAX_PROPOSAL_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    if (bytesRead > MAX_PROPOSAL_BYTES) throw new Error("PROPOSAL_FILE_INVALID");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    const parsed: unknown = JSON.parse(text);
    const identity = researchExperimentIdentityV1(parsed);
    if (identity.spec.organizationId !== organizationId.toLowerCase() ||
        identity.spec.organizationId !== RESEARCH_DEVELOPMENT_SOURCE_ORG_V1) {
      throw new Error("PROPOSAL_FILE_INVALID");
    }
    return identity.spec;
  } catch {
    throw new Error("PROPOSAL_FILE_INVALID");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

type ExperimentOwner = typeof registerResearchExperimentPostgresV1;
type IssuedAttemptOwner = typeof registerResearchIssuedAttemptPostgresV2;

export function buildExperimentRegistrationSummary(result: Awaited<ReturnType<ExperimentOwner>>) {
  return Object.freeze({
    status: "CONFIRMED" as const,
    authority: "REGISTRATION_ONLY" as const,
    organizationId: result.spec.organizationId,
    specSha256: result.specSha256,
    registrationOnly: true as const,
    scientificQualified: false as const,
    capitalEligible: false as const,
  });
}

export function buildIssuedAttemptRegistrationSummary(result: Awaited<ReturnType<IssuedAttemptOwner>>) {
  return Object.freeze({
    status: "CONFIRMED" as const,
    authority: "REGISTRATION_ONLY" as const,
    organizationId: result.organizationId,
    attemptId: result.id,
    specSha256: result.specSha256,
    sourceRunId: result.sourceRunId,
    sourceIssuanceDigest: result.sourceIssuanceDigest,
    registrationOnly: true as const,
    scientificQualified: false as const,
    capitalEligible: false as const,
  });
}

type BranchResult = { handled: boolean; exitCode: number; error?: string };

export async function runDiscoveryExperimentRegistrationBranch(
  argv: readonly string[],
  input: {
    cliEnabled: boolean;
    authorize(): void;
    readProposal(path: string, organizationId: string): Promise<ResearchExperimentSpecV1>;
    register(organizationId: string, proposal: ResearchExperimentSpecV1): ReturnType<ExperimentOwner>;
    print(value: ReturnType<typeof buildExperimentRegistrationSummary>): void;
  },
): Promise<BranchResult> {
  if (!argv.some(arg => arg === "--register-experiment" || arg.startsWith("--register-experiment="))) {
    return { handled: false, exitCode: 0 };
  }
  if (!input.cliEnabled) return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  let request: ExperimentRegistrationRequest;
  try {
    request = parseDiscoveryExperimentRegistrationArgs(argv)!;
  } catch {
    return { handled: true, exitCode: 1, error: "EXPERIMENT_REGISTRATION_ARGUMENTS_INVALID" };
  }
  try {
    input.authorize();
  } catch {
    return { handled: true, exitCode: 1, error: "REGISTRATION_AUTHORIZATION_REQUIRED" };
  }
  try {
    const proposal = await input.readProposal(request.proposalFile, request.organizationId);
    const result = await input.register(request.organizationId, proposal);
    input.print(buildExperimentRegistrationSummary(result));
    return { handled: true, exitCode: 0 };
  } catch {
    return { handled: true, exitCode: 1, error: "EXPERIMENT_REGISTRATION_FAILED" };
  }
}

export async function runDiscoveryIssuedAttemptRegistrationBranch(
  argv: readonly string[],
  input: {
    cliEnabled: boolean;
    authorize(): void;
    register(request: IssuedAttemptRegistrationRequest): ReturnType<IssuedAttemptOwner>;
    print(value: ReturnType<typeof buildIssuedAttemptRegistrationSummary>): void;
  },
): Promise<BranchResult> {
  if (!argv.some(arg => arg === "--register-issued-attempt" || arg.startsWith("--register-issued-attempt="))) {
    return { handled: false, exitCode: 0 };
  }
  if (!input.cliEnabled) return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  let request: IssuedAttemptRegistrationRequest;
  try {
    request = parseDiscoveryIssuedAttemptRegistrationArgs(argv)!;
  } catch {
    return { handled: true, exitCode: 1, error: "ISSUED_ATTEMPT_REGISTRATION_ARGUMENTS_INVALID" };
  }
  try {
    input.authorize();
  } catch {
    return { handled: true, exitCode: 1, error: "REGISTRATION_AUTHORIZATION_REQUIRED" };
  }
  try {
    const result = await input.register(request);
    input.print(buildIssuedAttemptRegistrationSummary(result));
    return { handled: true, exitCode: 0 };
  } catch {
    return { handled: true, exitCode: 1, error: "ISSUED_ATTEMPT_REGISTRATION_FAILED" };
  }
}
