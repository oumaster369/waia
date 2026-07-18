import { readGitCodeSha, readGitDirtyTree } from "@/lib/trader/backtest/replay-benchmark-harness";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import {
  assertHtrExecutionServerPackageManifest,
  buildHtrExecutionServerPackageManifest,
  computeHtrExecutionServerPackageDigest,
} from "@/lib/trader/readiness/htr-execution-server-package";
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

export function runHtrReadinessPreflight(
  input: HtrReadinessPreflightInput,
): HtrReadinessPreflightResult {
  const failureCodes: string[] = [];
  const sourceGitSha = input.sourceGitSha ?? readGitCodeSha();
  const sourceDirtyTree = readGitDirtyTree();

  collectFailure(() => assertHtrExecutionServerPackageManifest(), failureCodes);

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
