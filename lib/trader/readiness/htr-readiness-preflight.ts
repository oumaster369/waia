import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertHtrExecutionServerPackageManifest,
  buildHtrExecutionServerPackageManifest,
  computeHtrExecutionServerPackageDigest,
} from "@/lib/trader/readiness/htr-execution-server-package";
import {
  assertHtrHistoricalCostModelMatch,
  createHtrHistoricalCostModelAuthorityV1,
} from "@/lib/trader/execution/htr-historical-cost-model-authority";
import {
  HTR_FHV_DATASET_SOURCE_CLASSIFICATION,
  HTR_FHV_RUN_CONTRACT_V0,
  assertHtrFhvRunContractMatch,
  computeHtrFhvRunContractDigest,
  type HtrFhvRunCandidateInput,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";
import { HTR_OPERATOR_REPORT_SCHEMA_VERSION } from "@/lib/trader/readiness/htr-operator-report-schema.v1";
import {
  HTR_READINESS_GATE_GROUP_IDS,
  listHtrReadinessGateGroupsRequiringPreflight,
} from "@/lib/trader/readiness/htr-readiness-gate-groups";
import { assertHtrPostgresConnectionEnvironment } from "@/lib/trader/readiness/htr-postgres-connection-preflight";

export const HTR_READINESS_PREFLIGHT_SCHEMA_VERSION = "htr-readiness-preflight-report/v1" as const;

export type HtrReadinessPreflightTerminalState =
  | "HTR_WP23_READINESS_PREFLIGHT_PASS"
  | "HTR_WP23_READINESS_PREFLIGHT_FAIL";

export type HtrReadinessPreflightInput = Readonly<{
  mode: "self-test" | "candidate-run";
  candidate?: HtrFhvRunCandidateInput;
  operatorConfirmationTokens?: readonly string[];
  sourceGitSha?: string;
  validatePostgresConnection?: boolean;
}>;

export type HtrReadinessPreflightResult = Readonly<{
  schemaVersion: typeof HTR_READINESS_PREFLIGHT_SCHEMA_VERSION;
  terminalState: HtrReadinessPreflightTerminalState;
  sourceGitSha: string;
  sourceDirtyTree: boolean;
  fhvRunContractDigest: string;
  executionServerPackageDigest: string;
  operatorReportSchemaVersion: typeof HTR_OPERATOR_REPORT_SCHEMA_VERSION;
  gateGroupIds: readonly (typeof HTR_READINESS_GATE_GROUP_IDS)[number][];
  datasetSourceClassification: typeof HTR_FHV_DATASET_SOURCE_CLASSIFICATION;
  holdoutNoReadAttestation: true;
  noServerMutationAttestation: true;
  failureCodes: readonly string[];
  checkedAtUtc: string;
}>;

function collectFailure(run: () => void, codes: string[]): void {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof Error) {
      codes.push(error.message);
    } else {
      codes.push("HTR_WP23_PREFLIGHT:UNKNOWN_ERROR");
    }
  }
}

export function assertHtrReadinessCostModelAuthority(): void {
  const authority = createHtrHistoricalCostModelAuthorityV1();
  assertHtrHistoricalCostModelMatch(authority);
  assertHtrFhvRunContractMatch({
    costModelId: HTR_FHV_RUN_CONTRACT_V0.costModelId,
    costModelSchemaVersion: HTR_FHV_RUN_CONTRACT_V0.costModelSchemaVersion,
    feeBps: HTR_FHV_RUN_CONTRACT_V0.feeBps,
    halfSpreadBps: HTR_FHV_RUN_CONTRACT_V0.halfSpreadBps,
    marketImpactBps: HTR_FHV_RUN_CONTRACT_V0.marketImpactBps,
    slippageModel: HTR_FHV_RUN_CONTRACT_V0.slippageModel,
    costModelDigest: HTR_FHV_RUN_CONTRACT_V0.costModelDigest,
    costModelVersion: HTR_FHV_RUN_CONTRACT_V0.costModelVersion,
    costModelFeesBps: HTR_FHV_RUN_CONTRACT_V0.costModelFeesBps,
    costModelSlippageBps: HTR_FHV_RUN_CONTRACT_V0.costModelSlippageBps,
  });
}

export function runHtrReadinessPreflight(
  input: HtrReadinessPreflightInput,
): HtrReadinessPreflightResult {
  const failureCodes: string[] = [];
  const sourceGitSha = input.sourceGitSha ?? readGitCodeSha();
  const sourceDirtyTree = readGitDirtyTree();

  collectFailure(() => assertHtrExecutionServerPackageManifest(), failureCodes);
  collectFailure(() => assertHtrReadinessCostModelAuthority(), failureCodes);

  if (input.mode === "self-test") {
    if (HTR_FHV_DATASET_SOURCE_CLASSIFICATION !== "NOT_AVAILABLE") {
      failureCodes.push("HTR_WP23_PREFLIGHT:DATASET_SOURCE_CLASSIFICATION_INVALID");
    }
  }

  if (input.mode === "candidate-run") {
    if (!input.candidate) {
      failureCodes.push("HTR_WP23_PREFLIGHT:CANDIDATE_REQUIRED");
    } else {
      collectFailure(() => assertHtrFhvRunContractMatch(input.candidate!), failureCodes);
    }
  }

  if (input.validatePostgresConnection === true) {
    collectFailure(() => assertHtrPostgresConnectionEnvironment(), failureCodes);
  }

  if (input.operatorConfirmationTokens !== undefined) {
    const required = new Set(buildHtrExecutionServerPackageManifest().requiredConfirmationTokens);
    for (const token of input.operatorConfirmationTokens) {
      required.delete(token);
    }
    if (required.size > 0) {
      failureCodes.push("HTR_WP23_PREFLIGHT:OPERATOR_CONFIRMATION_TOKENS_INCOMPLETE");
    }
  }

  const terminalState: HtrReadinessPreflightTerminalState =
    failureCodes.length === 0
      ? "HTR_WP23_READINESS_PREFLIGHT_PASS"
      : "HTR_WP23_READINESS_PREFLIGHT_FAIL";

  return {
    schemaVersion: HTR_READINESS_PREFLIGHT_SCHEMA_VERSION,
    terminalState,
    sourceGitSha,
    sourceDirtyTree,
    fhvRunContractDigest: computeHtrFhvRunContractDigest(HTR_FHV_RUN_CONTRACT_V0),
    executionServerPackageDigest: computeHtrExecutionServerPackageDigest(),
    operatorReportSchemaVersion: HTR_OPERATOR_REPORT_SCHEMA_VERSION,
    gateGroupIds: listHtrReadinessGateGroupsRequiringPreflight().map((group) => group.id),
    datasetSourceClassification: HTR_FHV_DATASET_SOURCE_CLASSIFICATION,
    holdoutNoReadAttestation: true,
    noServerMutationAttestation: true,
    failureCodes,
    checkedAtUtc: new Date().toISOString(),
  };
}

export function computeHtrReadinessPreflightDigest(result: HtrReadinessPreflightResult): string {
  const { checkedAtUtc: _checkedAtUtc, ...stablePayload } = result;
  return computeSemanticSha256Hex(stablePayload as unknown as Record<string, unknown>);
}

export function assertHtrReadinessPreflightPass(result: HtrReadinessPreflightResult): void {
  if (result.terminalState !== "HTR_WP23_READINESS_PREFLIGHT_PASS") {
    throw new Error(`HTR_WP23_PREFLIGHT:FAIL:${result.failureCodes.join(",") || "UNKNOWN"}`);
  }
}

const HTR_WP23_CLI_KNOWN_FLAGS = new Set([
  "--self-test",
  "--candidate-json",
  "--validate-postgres-connection",
  "--emit-evidence",
  "--staging-only",
  "--source-git-sha",
]);

const HTR_WP23_CLI_FORBIDDEN_FLAGS = new Set([
  "--holdout-read",
  "--read-holdout",
  "--mutate-execution-server",
  "--execution-server-mutation",
  "--accepted-path",
  "--promote-evidence",
]);

export type HtrWp23ReadinessPreflightCliMode =
  | { kind: "self-test"; validatePostgresConnection?: boolean }
  | { kind: "candidate-run"; candidateJson: string; validatePostgresConnection?: boolean }
  | { kind: "evidence-seal"; sourceGitSha: string; validatePostgresConnection?: boolean };

function readFlagValue(argv: string[], flag: string): string | undefined {
  const indexes = argv.reduce<number[]>((found, token, index) => {
    if (token === flag) {
      found.push(index);
    }
    return found;
  }, []);
  if (indexes.length > 1) {
    throw new Error(
      `HTR_WP23_PREFLIGHT_CLI:DUPLICATE_${flag.slice(2).replace(/-/g, "_").toUpperCase()}`,
    );
  }
  const index = indexes[0];
  if (index === undefined) {
    return undefined;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(
      `HTR_WP23_PREFLIGHT_CLI:${flag.slice(2).replace(/-/g, "_").toUpperCase()}_VALUE_REQUIRED`,
    );
  }
  return value;
}

export function parseHtrWp23ReadinessPreflightCliArgs(
  argv: string[],
): HtrWp23ReadinessPreflightCliMode {
  const normalizedArgv = argv.filter((token) => token !== "--");
  for (const token of normalizedArgv) {
    if (!token.startsWith("--")) {
      continue;
    }
    if (HTR_WP23_CLI_FORBIDDEN_FLAGS.has(token)) {
      throw new Error(`HTR_WP23_PREFLIGHT_CLI:FORBIDDEN_FLAG:${token}`);
    }
    if (!HTR_WP23_CLI_KNOWN_FLAGS.has(token)) {
      throw new Error(`HTR_WP23_PREFLIGHT_CLI:UNKNOWN_FLAG:${token}`);
    }
  }

  const validatePostgresConnection = normalizedArgv.includes("--validate-postgres-connection");
  const emitEvidence = normalizedArgv.includes("--emit-evidence");
  const stagingOnly = normalizedArgv.includes("--staging-only");
  const selfTest = normalizedArgv.includes("--self-test");
  const candidateJson = readFlagValue(normalizedArgv, "--candidate-json");
  const sourceGitSha = readFlagValue(normalizedArgv, "--source-git-sha");

  if (emitEvidence) {
    if (!stagingOnly) {
      throw new Error("HTR_WP23_EVIDENCE_SEAL:STAGING_ONLY_REQUIRED");
    }
    if (!sourceGitSha) {
      throw new Error("HTR_WP23_EVIDENCE_SEAL:SOURCE_GIT_SHA_REQUIRED");
    }
    if (selfTest || candidateJson !== undefined) {
      throw new Error("HTR_WP23_EVIDENCE_SEAL:INCOMPATIBLE_MODE_FLAGS");
    }
    return { kind: "evidence-seal", sourceGitSha, validatePostgresConnection };
  }

  if (stagingOnly || sourceGitSha) {
    throw new Error("HTR_WP23_EVIDENCE_SEAL:EMIT_EVIDENCE_REQUIRED");
  }

  if (selfTest && candidateJson !== undefined) {
    throw new Error("HTR_WP23_PREFLIGHT_CLI:SELF_TEST_AND_CANDIDATE_JSON_EXCLUSIVE");
  }
  if (selfTest) {
    return { kind: "self-test", validatePostgresConnection };
  }
  if (candidateJson !== undefined) {
    return { kind: "candidate-run", candidateJson, validatePostgresConnection };
  }

  throw new Error("HTR_WP23_PREFLIGHT_CLI:SELF_TEST_OR_CANDIDATE_JSON_OR_EVIDENCE_REQUIRED");
}
