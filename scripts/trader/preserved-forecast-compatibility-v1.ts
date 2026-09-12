import { createHash } from "node:crypto";
import { deserialize } from "node:v8";
import { computeSemanticSha256Hex } from "../../lib/trader/intelligence/htr-semantic-canonical-json";
import { terminalRhFromOutcome13dV1 } from "../../lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import { deriveScientificCheckpointKeyV1, type ExpectedScientificCheckpointV1 } from "./scientific-checkpoint-key-v1";
import { assertTerminalProbabilityVectorV2, TERMINAL_SCORING_AMENDMENT_DIGEST,
  TERMINAL_SCORING_CONTRACT } from "../../lib/trader/research/benchmark/terminal-scoring-protocol-v2";

type Runtime = ExpectedScientificCheckpointV1["runtime"];
/** Independently reconstructed original dependencies, NOT discovered from the cache
 * being evaluated. This local checker is not an authority issuer or a store reader. */
export type PreservedForecastDependenciesV1 = {
  organizationId: string;
  symbol: string;
  primaryHorizonMinutes: 30 | 60;
  releaseSha: string;
  runtime: Runtime;
  runtimeContractDigestHex: string;
  developmentDatasetDigestHex: string;
  targetGridReceiptDigestHex: string;
  packageGenerationDigestHex: string;
  packageContentDigestHex: string;
  modelTransformDigestHex: string;
  normalizationDigestHex: string;
  randomnessRootDigestHex: string;
  evaluationPartitionReceiptDigestHex: string;
  sourceWindowDigestHex: string;
};
export type PreservedForecastCompatibilityInputV1 = {
  expectedOrigin: PreservedForecastDependenciesV1;
  observedOrigin: PreservedForecastDependenciesV1;
  evaluator: { releaseSha: string; runtime: Runtime; scoringContract: string; amendmentDigestHex: string };
  partition: "WF_PREDICTIVE";
  /** Original full store input; including original batch, offset and release SHA. */
  checkpoint: ExpectedScientificCheckpointV1;
  /** Must come from an authenticated original seal, never from hashing supplied bytes alone. */
  expectedPayloadDigestHex: string;
  expectedAnchors: readonly { anchorId: string; observedReturn: number }[];
};
function fail(reason: string): never { throw new Error(`PRESERVED_FORECAST_COMPATIBILITY_REFUSED:${reason}`); }
const digest = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
const dependencyFields = [
  "runtimeContractDigestHex", "developmentDatasetDigestHex", "targetGridReceiptDigestHex",
  "packageGenerationDigestHex", "packageContentDigestHex", "modelTransformDigestHex",
  "normalizationDigestHex", "randomnessRootDigestHex", "evaluationPartitionReceiptDigestHex",
  "sourceWindowDigestHex",
] as const;
function sameRuntime(a: Runtime, b: Runtime): boolean {
  return a.node === b.node && a.os === b.os && a.arch === b.arch;
}
function validRuntime(r: Runtime): boolean {
  return !!r && typeof r.node === "string" && /^v\d+\.\d+\.\d+$/.test(r.node) &&
    typeof r.os === "string" && /^[a-z0-9_]+$/.test(r.os) &&
    typeof r.arch === "string" && /^[a-z0-9_]+$/.test(r.arch);
}

/** Local read-only payload compatibility. No scorer, Forecast, bootstrap, builders,
 * package hydration, filesystem IO, checkpoint writes or application admission.
 * The returned original anchor IDs are a binding digest, never relabeled with the
 * evaluator SHA. The production adapter must additionally authenticate seals and
 * independently establish every dependency/expected anchor before using this check.
 */
export function inspectPreservedForecastBatchCompatibilityV1(
  input: PreservedForecastCompatibilityInputV1,
  artifact: { key: string; payload: Buffer },
) {
  const { expectedOrigin: expected, observedOrigin: observed, evaluator, checkpoint } = input;
  if (input.partition !== "WF_PREDICTIVE" || checkpoint.stage !== "wf-forecast-batch-v1" ||
      checkpoint.kind !== "evidence") fail("STAGE_OR_PARTITION");
  if (!sha(expected.releaseSha) || !sha(observed.releaseSha) || !sha(evaluator.releaseSha) ||
      !validRuntime(expected.runtime) || !validRuntime(observed.runtime) || !validRuntime(evaluator.runtime) ||
      !expected.organizationId || expected.organizationId !== observed.organizationId ||
      !["BTCUSDT", "ETHUSDT"].includes(expected.symbol) || expected.symbol !== observed.symbol ||
      ![30, 60].includes(expected.primaryHorizonMinutes) ||
      expected.primaryHorizonMinutes !== observed.primaryHorizonMinutes ||
      expected.releaseSha !== observed.releaseSha || !sameRuntime(expected.runtime, observed.runtime) ||
      checkpoint.releaseSha !== expected.releaseSha || !sameRuntime(checkpoint.runtime, expected.runtime))
    fail("ORIGIN");
  for (const field of dependencyFields)
    if (!digest(expected[field]) || expected[field] !== observed[field]) fail("DEPENDENCY");
  if (evaluator.scoringContract !== TERMINAL_SCORING_CONTRACT ||
      evaluator.amendmentDigestHex !== TERMINAL_SCORING_AMENDMENT_DIGEST) fail("EVALUATOR_PROTOCOL");
  // Derivation validates the full original input without trusting an observed key.
  const key = deriveScientificCheckpointKeyV1(checkpoint);
  if (key !== artifact.key) fail("EXPECTED_KEY");
  const original = checkpoint.input as Record<string, unknown>;
  if (!original || original.releaseSha !== expected.releaseSha ||
      original.organizationId !== expected.organizationId ||
      original.generationDigest !== expected.packageGenerationDigestHex ||
      original.packageDigest !== expected.packageContentDigestHex ||
      original.evaluationPartitionReceiptDigestHex !== expected.evaluationPartitionReceiptDigestHex ||
      !Number.isSafeInteger(original.offset) || (original.offset as number) < 0 ||
      !Array.isArray(original.batch) || original.batch.length !== input.expectedAnchors.length)
    fail("INPUT_BINDINGS");
  if (!Buffer.isBuffer(artifact.payload) || artifact.payload.length > 65536 ||
      !digest(input.expectedPayloadDigestHex) ||
      createHash("sha256").update(artifact.payload).digest("hex") !== input.expectedPayloadDigestHex) fail("PAYLOAD");
  let rows: unknown;
  try { rows = deserialize(artifact.payload); } catch { return fail("DECODE"); }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 32 ||
      !Array.isArray(input.expectedAnchors) || rows.length !== input.expectedAnchors.length) fail("BATCH");
  const seen = new Set<string>();
  const anchors = createHash("sha256").update("preserved-original-anchor-map/v1\n");
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], anchor = input.expectedAnchors[i];
    const source = original.batch[i];
    if (!source || source.symbol !== expected.symbol || source.venue !== "htx" || source.market !== "spot" ||
        !Number.isSafeInteger(source.closedBarEpochMs) || !digest(source.barContentDigest) ||
        !Array.isArray(source.outcome13d) || source.outcome13d.length !== 13 ||
        Array.from(source.outcome13d).some(x => typeof x !== "number" || !Number.isFinite(x)))
      fail("ORIGINAL_SOURCE");
    const originalAnchorId = computeSemanticSha256Hex({
      schemaVersion: "waia.trader.wf_predictive_anchor.v2",
      surfaceKey: `${expected.symbol}:${expected.primaryHorizonMinutes}`,
      closedBarEpochMs: source.closedBarEpochMs,
      barContentDigest: source.barContentDigest,
      evaluationPartitionReceiptDigestHex: expected.evaluationPartitionReceiptDigestHex,
    });
    if (!row || Object.getPrototypeOf(row) !== Object.prototype ||
        Object.keys(row).sort().join(",") !== "anchorId,challengerProbabilities,observedReturn" ||
        !anchor || !digest(anchor.anchorId) || !Number.isFinite(anchor.observedReturn) ||
        row.anchorId !== originalAnchorId || row.anchorId !== anchor.anchorId ||
        !Object.is(row.observedReturn, terminalRhFromOutcome13dV1(source.outcome13d)) ||
        !Object.is(row.observedReturn, anchor.observedReturn) ||
        seen.has(row.anchorId)) fail("ANCHOR_MAPPING");
    assertTerminalProbabilityVectorV2(row.challengerProbabilities);
    seen.add(row.anchorId);
    anchors.update(row.anchorId).update("\n");
  }
  return Object.freeze({
    schemaVersion: "preserved-forecast-compatibility/v1" as const,
    status: "LOCAL_BINDINGS_MATCH_NOT_ADMISSION" as const,
    authorityGranted: false as const,
    authenticatedStoreRead: "REQUIRED_SEPARATELY" as const,
    independentProvenance: "REQUIRED_SEPARATELY" as const,
    originReleaseSha: expected.releaseSha,
    evaluatorReleaseSha: evaluator.releaseSha,
    originalCheckpointKey: key,
    originalPayloadDigestHex: input.expectedPayloadDigestHex,
    originalAnchorMapDigestHex: anchors.digest("hex"),
    anchorCount: rows.length,
    primaryScoresAndBootstrap: "MUST_RECOMPUTE_WITH_SEPARATE_AUTHORIZATION" as const,
  });
}
