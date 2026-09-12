// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { buildPreservedWfExpectedInventoryV1, comparePreservedWfInventoryCoverageV1 } from "../../scripts/trader/preserved-wf-inventory-v1";
import { readPreservedForecastEvidenceV1 } from "../../scripts/trader/preserved-forecast-reader-v1";
import { inspectPreservedForecastBatchCompatibilityV1 } from "../../scripts/trader/preserved-forecast-compatibility-v1";
import { TERMINAL_SCORING_AMENDMENT_DIGEST, TERMINAL_SCORING_CONTRACT } from "@/lib/trader/research/benchmark/terminal-scoring-protocol-v2";

it("maps synthetic original inputs through authenticated read and compatibility without generation on recovery", () => {
  const h = (v: string) => createHash("sha256").update(v).digest("hex");
  const runtime = {node:process.version,os:process.platform,arch:process.arch};
  const origin = {organizationId:"synthetic-org",symbol:"BTCUSDT" as const,primaryHorizonMinutes:30 as const,
    releaseSha:"a".repeat(40),runtime,packageGenerationDigestHex:h("generation"),packageContentDigestHex:h("package")};
  const partition = h("partition");
  const inventory = buildPreservedWfExpectedInventoryV1({origin,evaluationPartitionReceiptDigestHex:partition,
    sourceCorpus:Array.from({length:33},(_,i)=>({venue:"htx",market:"spot",symbol:"BTCUSDT",
      closedBarEpochMs:1700000000000+i*60000,barContentDigest:h(`bar${i}`),realizedVol20m_1m:0.01,outcome13d:Array(13).fill(0)}))});
  const dependencies = {...origin,evaluationPartitionReceiptDigestHex:partition,
    runtimeContractDigestHex:h("runtime"),developmentDatasetDigestHex:h("development"),targetGridReceiptDigestHex:h("grid"),
    modelTransformDigestHex:h("model"),normalizationDigestHex:h("normalization"),randomnessRootDigestHex:h("rng"),sourceWindowDigestHex:h("window")};
  const root = realpathSync(mkdtempSync(join(tmpdir(),"dee991-composition-test-")));
  vi.stubEnv("WAIA_TRADER_CLI","1");
  try {
    const store = createScientificCheckpointStoreV1(root,origin.releaseSha);
    const first = inventory.batches[0]!;
    const originalFixtureBuilder = vi.fn(()=>first.expectedAnchors.map(a=>({...a,challengerProbabilities:[1,0,0,0,0,0,0]})));
    store.evidence(first.checkpoint.stage,first.checkpoint.input,originalFixtureBuilder);
    const observations: {key:string;anchorCount:number}[] = [];
    for (const batch of inventory.batches) {
      const read = readPreservedForecastEvidenceV1(root,batch.checkpoint);
      if (read.status === "MISSING") { expect(read.generationPermitted).toBe(false); continue; }
      const check = inspectPreservedForecastBatchCompatibilityV1({expectedOrigin:dependencies,observedOrigin:dependencies,
        evaluator:{releaseSha:"b".repeat(40),runtime,scoringContract:TERMINAL_SCORING_CONTRACT,amendmentDigestHex:TERMINAL_SCORING_AMENDMENT_DIGEST},
        partition:"WF_PREDICTIVE",checkpoint:batch.checkpoint,expectedPayloadDigestHex:read.payloadDigestHex,
        expectedAnchors:batch.expectedAnchors},{key:read.key,payload:read.payload});
      expect(check.originReleaseSha).toBe(origin.releaseSha); expect(check.authorityGranted).toBe(false);
      observations.push({key:read.key,anchorCount:check.anchorCount});
    }
    const coverage = comparePreservedWfInventoryCoverageV1(inventory,observations);
    expect(coverage.missingKeys).toEqual([inventory.batches[1]!.key]);
    expect(coverage.status).toBe("SUPPLIED_KEY_COVERAGE_MISMATCH");
    expect(coverage.inputProvenance).toBe("NOT_ESTABLISHED");
    expect(originalFixtureBuilder).toHaveBeenCalledTimes(1);
  } finally { vi.unstubAllEnvs(); rmSync(root,{recursive:true,force:true}); }
});
