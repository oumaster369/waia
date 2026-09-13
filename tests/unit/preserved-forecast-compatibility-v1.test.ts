// @vitest-environment node
import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { describe, expect, it } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { TERMINAL_SCORING_AMENDMENT_DIGEST, TERMINAL_SCORING_CONTRACT } from "@/lib/trader/research/benchmark/terminal-scoring-protocol-v2";
import { deriveScientificCheckpointKeyV1 } from "../../scripts/trader/scientific-checkpoint-key-v1";
import { inspectPreservedForecastBatchCompatibilityV1, type PreservedForecastCompatibilityInputV1 } from "../../scripts/trader/preserved-forecast-compatibility-v1";

const h = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const origin = {
    organizationId: "synthetic-org", symbol: "BTCUSDT", primaryHorizonMinutes: 30 as const,
    releaseSha: "a".repeat(40), runtime: { node: "v22.23.2", os: "linux", arch: "x64" },
    runtimeContractDigestHex: h("runtime"), developmentDatasetDigestHex: h("development"),
    targetGridReceiptDigestHex: h("grid"), packageGenerationDigestHex: h("generation"),
    packageContentDigestHex: h("package"), modelTransformDigestHex: h("model"),
    normalizationDigestHex: h("normalization"), randomnessRootDigestHex: h("root"),
    evaluationPartitionReceiptDigestHex: h("partition"), sourceWindowDigestHex: h("source"),
  };
  const batch = [{ venue: "htx", market: "spot", symbol: "BTCUSDT", closedBarEpochMs: 1700000000000,
    barContentDigest: h("bar"), realizedVol20m_1m: 0.01, outcome13d: Array(13).fill(0) }];
  const anchorId = computeSemanticSha256Hex({ schemaVersion: "waia.trader.wf_predictive_anchor.v2",
    surfaceKey: "BTCUSDT:30", closedBarEpochMs: batch[0]!.closedBarEpochMs,
    barContentDigest: batch[0]!.barContentDigest, evaluationPartitionReceiptDigestHex: origin.evaluationPartitionReceiptDigestHex });
  const rows = [{ anchorId, observedReturn: 0, challengerProbabilities: [1, 0, 0, 0, 0, 0, 0] }];
  const payload = serialize(rows);
  const input: PreservedForecastCompatibilityInputV1 = {
    expectedOrigin: origin, observedOrigin: structuredClone(origin),
    evaluator: { releaseSha: "b".repeat(40), runtime: { node: "v22.23.0", os: "darwin", arch: "arm64" },
      scoringContract: TERMINAL_SCORING_CONTRACT, amendmentDigestHex: TERMINAL_SCORING_AMENDMENT_DIGEST },
    partition: "WF_PREDICTIVE",
    checkpoint: { releaseSha: origin.releaseSha, runtime: origin.runtime, stage: "wf-forecast-batch-v1", kind: "evidence",
      input: { organizationId: origin.organizationId, releaseSha: origin.releaseSha,
        generationDigest: origin.packageGenerationDigestHex, packageDigest: origin.packageContentDigestHex,
        evaluationPartitionReceiptDigestHex: origin.evaluationPartitionReceiptDigestHex, offset: 0, batch } },
    expectedPayloadDigestHex: createHash("sha256").update(payload).digest("hex"),
    expectedAnchors: [{ anchorId, observedReturn: 0 }],
  };
  return { input, artifact: { key: deriveScientificCheckpointKeyV1(input.checkpoint), payload }, rows };
}
describe("DEE-991 original-input/evaluator separation for DEE-992", () => {
  it("preserves original key/anchor/payload bytes under a distinct evaluator; grants no authority", () => {
    const { input, artifact } = fixture();
    const before = serialize({ input, artifact });
    const result = inspectPreservedForecastBatchCompatibilityV1(input, artifact);
    expect(result).toMatchObject({ status: "LOCAL_BINDINGS_MATCH_NOT_ADMISSION", authorityGranted: false,
      originReleaseSha: "a".repeat(40), evaluatorReleaseSha: "b".repeat(40),
      originalCheckpointKey: artifact.key, anchorCount: 1,
      primaryScoresAndBootstrap: "MUST_RECOMPUTE_WITH_SEPARATE_AUTHORIZATION",
      authenticatedStoreRead: "REQUIRED_SEPARATELY", independentProvenance: "REQUIRED_SEPARATELY" });
    expect(serialize({ input, artifact })).toEqual(before);
    expect(inspectPreservedForecastBatchCompatibilityV1(input, artifact)).toEqual(result);
  });
  it.each(["runtimeContractDigestHex", "developmentDatasetDigestHex", "targetGridReceiptDigestHex",
    "packageGenerationDigestHex", "packageContentDigestHex", "modelTransformDigestHex",
    "normalizationDigestHex", "randomnessRootDigestHex", "evaluationPartitionReceiptDigestHex",
    "sourceWindowDigestHex"] as const)("refuses changed dependency %s", field => {
    const { input, artifact } = fixture();
    input.observedOrigin[field] = h("changed");
    expect(() => inspectPreservedForecastBatchCompatibilityV1(input, artifact)).toThrow("DEPENDENCY");
  });
  it.each(["origin-sha", "origin-runtime", "relabel-key", "score", "amendment", "holdout", "old-score-stage", "missing-row", "changed-anchor", "wrong-outcome", "payload"])("refuses %s without any builder fallback", kind => {
    const { input, artifact } = fixture();
    if (kind === "origin-sha") input.observedOrigin.releaseSha = input.evaluator.releaseSha;
    if (kind === "origin-runtime") input.observedOrigin.runtime.node = "v22.23.0";
    if (kind === "relabel-key") input.checkpoint.releaseSha = input.evaluator.releaseSha;
    if (kind === "score") input.evaluator.scoringContract = "multiclass-log-score/v1";
    if (kind === "amendment") input.evaluator.amendmentDigestHex = h("wrong");
    if (kind === "holdout") input.partition = "BLIND_HOLDOUT" as typeof input.partition;
    if (kind === "old-score-stage") input.checkpoint.stage = "wf-predictive-terminal-v1";
    if (kind === "missing-row") input.expectedAnchors = [];
    if (kind === "changed-anchor") input.expectedAnchors = [{ anchorId: h("different"), observedReturn: 0 }];
    if (kind === "wrong-outcome") input.expectedAnchors = [{ ...input.expectedAnchors[0]!, observedReturn: 1 }];
    if (kind === "payload") artifact.payload = Buffer.from("corrupt");
    expect(() => inspectPreservedForecastBatchCompatibilityV1(input, artifact)).toThrow("REFUSED");
  });
  it("rejects invalid saved probabilities even if payload identity matches", () => {
    const { input, artifact, rows } = fixture();
    rows[0]!.challengerProbabilities = [0.1, 0, 0, 0, 0, 0, 0];
    artifact.payload = serialize(rows);
    input.expectedPayloadDigestHex = createHash("sha256").update(artifact.payload).digest("hex");
    expect(() => inspectPreservedForecastBatchCompatibilityV1(input, artifact)).toThrow("TERMINAL_SCORE_INVALID_PROBABILITIES");
  });
  it("does not accept changed original batch inputs under the old expected key", () => {
    const { input, artifact } = fixture();
    (input.checkpoint.input as { offset: number }).offset = 32;
    expect(() => inspectPreservedForecastBatchCompatibilityV1(input, artifact)).toThrow("EXPECTED_KEY");
  });
});
