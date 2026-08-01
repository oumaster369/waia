import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { HTR_HISTORICAL_COST_MODEL_DIGEST } from "@/lib/trader/execution/htr-historical-cost-model-authority";
import { D20_DRAWDOWN_POLICY_VERSION } from "@/lib/trader/risk/drawdown-policy.types";
import {
  computeHtrFhvRunContractDigest,
  HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT,
  HTR_FHV_RUN_CONTRACT_SCHEMA_VERSION,
  HTR_FHV_RUN_CONTRACT_V0,
} from "@/lib/trader/readiness/htr-fhv-run-contract-v0";

export const FHV_CONFIGURATION_FREEZE_SCHEMA_VERSION = "fhv-configuration-freeze/v1" as const;

export type FhvConfigurationFreezeV1 = Readonly<{
  schemaVersion: typeof FHV_CONFIGURATION_FREEZE_SCHEMA_VERSION;
  releaseSha: string;
  releaseTag?: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  runContractVersion: typeof HTR_FHV_RUN_CONTRACT_SCHEMA_VERSION;
  runContractDigest: string;
  datasetDigest: string;
  manifestDigest: string;
  strategyVersions: readonly string[];
  strategyDigests: readonly string[];
  initialCapitalUsdt: typeof HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT;
  costModelDigest: typeof HTR_HISTORICAL_COST_MODEL_DIGEST;
  drawdownPolicyVersion: typeof D20_DRAWDOWN_POLICY_VERSION;
  checkpointDigest: string;
  configurationFreezeDigest: string;
}>;

export class FhvConfigurationFreezeError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FhvConfigurationFreezeError";
  }
}

export function computeFhvConfigurationFreezeDigest(
  freeze: Omit<FhvConfigurationFreezeV1, "configurationFreezeDigest">,
): string {
  const { configurationFreezeDigest: _digest, ...payload } = freeze as FhvConfigurationFreezeV1;
  return computeSemanticSha256Hex(payload as unknown as Record<string, unknown>);
}

export function buildFhvConfigurationFreeze(input: {
  releaseSha: string;
  releaseTag?: string;
  runId: string;
  organizationId: string;
  operatorId: string;
  datasetDigest: string;
  manifestDigest: string;
  strategyVersions: readonly string[];
  strategyDigests: readonly string[];
  checkpointDigest: string;
}): FhvConfigurationFreezeV1 {
  const runContractDigest = computeHtrFhvRunContractDigest(HTR_FHV_RUN_CONTRACT_V0);
  const base: Omit<FhvConfigurationFreezeV1, "configurationFreezeDigest"> = {
    schemaVersion: FHV_CONFIGURATION_FREEZE_SCHEMA_VERSION,
    releaseSha: input.releaseSha,
    ...(input.releaseTag ? { releaseTag: input.releaseTag } : {}),
    runId: input.runId,
    organizationId: input.organizationId,
    operatorId: input.operatorId,
    runContractVersion: HTR_FHV_RUN_CONTRACT_SCHEMA_VERSION,
    runContractDigest,
    datasetDigest: input.datasetDigest,
    manifestDigest: input.manifestDigest,
    strategyVersions: [...input.strategyVersions],
    strategyDigests: [...input.strategyDigests],
    initialCapitalUsdt: HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT,
    costModelDigest: HTR_HISTORICAL_COST_MODEL_DIGEST,
    drawdownPolicyVersion: D20_DRAWDOWN_POLICY_VERSION,
    checkpointDigest: input.checkpointDigest,
  };
  return {
    ...base,
    configurationFreezeDigest: computeFhvConfigurationFreezeDigest(base),
  };
}

export function assertFhvConfigurationFreezeMatch(
  candidate: FhvConfigurationFreezeV1,
  expectedDigest: string,
): void {
  const recomputed = computeFhvConfigurationFreezeDigest(candidate);
  if (recomputed !== expectedDigest) {
    throw new FhvConfigurationFreezeError(
      "CONFIGURATION_FREEZE_DIGEST_MISMATCH",
      "Configuration freeze digest mismatch.",
    );
  }
  if (candidate.initialCapitalUsdt !== HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT) {
    throw new FhvConfigurationFreezeError(
      "INITIAL_CAPITAL_MISMATCH",
      `Initial capital must be exactly ${HTR_FHV_RUN_CONTRACT_INITIAL_CASH_USDT} USDT.`,
    );
  }
  if (candidate.runContractDigest !== computeHtrFhvRunContractDigest(HTR_FHV_RUN_CONTRACT_V0)) {
    throw new FhvConfigurationFreezeError(
      "RUN_CONTRACT_DIGEST_MISMATCH",
      "Run contract digest does not match pinned FULL_HISTORICAL_VALIDATION_RUN_CONTRACT_V0.",
    );
  }
  if (candidate.costModelDigest !== HTR_HISTORICAL_COST_MODEL_DIGEST) {
    throw new FhvConfigurationFreezeError(
      "COST_MODEL_DIGEST_MISMATCH",
      "Cost model digest mismatch.",
    );
  }
}
