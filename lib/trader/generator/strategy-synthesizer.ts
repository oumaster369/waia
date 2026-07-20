import { createHash } from "node:crypto";

import { canonicalJsonString } from "@/lib/trader/paper/serialize-paper-evaluation-export";
import {
  GENERATOR_SCHEMA_VERSION,
  type StrategySynthesisOutput,
  type StrategySynthesizerInput,
} from "@/lib/trader/generator/generator.types";
import { getStrategyTemplate } from "@/lib/trader/generator/strategy-template-registry";
import { buildStrategyLineage } from "@/lib/trader/generator/strategy-lineage";

function bumpPatchVersion(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) {
    return `${version}.1`;
  }
  const patch = Number(parts[2] ?? "0") + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

function buildParamDigest(templateId: string, params: StrategySynthesizerInput["params"]): string {
  return createHash("sha256")
    .update(canonicalJsonString({ templateId, params }), "utf8")
    .digest("hex");
}

export function synthesizeStrategyFromTemplate(
  input: StrategySynthesizerInput,
): StrategySynthesisOutput {
  const template = getStrategyTemplate(input.templateId);
  const parentStrategyVersion =
    input.parentStrategyVersion ?? input.priorStrategyVersion ?? "0.1.0";
  const strategyVersion = bumpPatchVersion(parentStrategyVersion);
  const paramsJson = JSON.stringify(input.params);
  const paramDigest = buildParamDigest(input.templateId, input.params);
  const lineage = buildStrategyLineage({
    strategyId: template.strategyId,
    strategyVersion,
    parentStrategyId: input.parentStrategyId ?? template.strategyId,
    parentStrategyVersion,
    templateId: input.templateId,
    paramDigest,
  });

  const contentDigest = createHash("sha256")
    .update(
      canonicalJsonString({
        schemaVersion: GENERATOR_SCHEMA_VERSION,
        synthesisId: input.synthesisId,
        lineage,
        paramsJson,
      }),
      "utf8",
    )
    .digest("hex");

  return {
    schemaVersion: GENERATOR_SCHEMA_VERSION,
    synthesisId: input.synthesisId,
    strategyId: template.strategyId,
    strategyVersion,
    templateId: input.templateId,
    paramsJson,
    paramDigest,
    parentStrategyId: lineage.parentStrategyId,
    parentStrategyVersion: lineage.parentStrategyVersion,
    contentDigest,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function synthesizeDefaultStrategy(
  templateId: StrategySynthesizerInput["templateId"],
  synthesisId: string,
  priorStrategyVersion = "0.1.0",
): StrategySynthesisOutput {
  const template = getStrategyTemplate(templateId);
  return synthesizeStrategyFromTemplate({
    templateId,
    params: template.defaultParams,
    parentStrategyId: template.strategyId,
    parentStrategyVersion: priorStrategyVersion,
    synthesisId,
  });
}
