// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { computeSemanticSha256Hex } from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { buildPreservedWfExpectedInventoryV1, comparePreservedWfInventoryCoverageV1,
  type PreservedWfOriginalInputV1 } from "../../scripts/trader/preserved-wf-inventory-v1";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function fixture(count = 33): PreservedWfOriginalInputV1 {
  return { origin: { organizationId: "synthetic-org", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
    releaseSha: "a".repeat(40), runtime: { node: process.version, os: process.platform, arch: process.arch },
    packageGenerationDigestHex: hash("generation"), packageContentDigestHex: hash("package") },
  evaluationPartitionReceiptDigestHex: hash("original-receipt"),
  sourceCorpus: Array.from({ length: count }, (_, index) => ({ venue: "htx", market: "spot", symbol: "BTCUSDT",
    closedBarEpochMs: 1700000000000 + index * 60000, barContentDigest: hash(`bar-${index}`),
    realizedVol20m_1m: index === 0 ? -0 : 0.01, outcome13d: Array(13).fill(0) })) };
}
describe("pure original WF expected inventory", () => {
  it("matches keys actually published by the v1 store, including the final short batch", () => {
    const input = fixture(), inventory = buildPreservedWfExpectedInventoryV1(input);
    const root = realpathSync(mkdtempSync(join(tmpdir(), "dee991-wf-inventory-")));
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    try {
      const store = createScientificCheckpointStoreV1(root, input.origin.releaseSha);
      // Independent original call shape, not the generator's returned checkpoint.
      for (let offset = 0; offset < input.sourceCorpus.length; offset += 32) {
        store.evidence("wf-forecast-batch-v1", {
          organizationId: input.origin.organizationId, releaseSha: input.origin.releaseSha,
          generationDigest: input.origin.packageGenerationDigestHex, packageDigest: input.origin.packageContentDigestHex,
          evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex, offset,
          batch: input.sourceCorpus.slice(offset, offset + 32),
        }, () => ({ synthetic: true }));
      }
      expect(inventory.batches.map(entry => entry.key).sort()).toEqual(
        readdirSync(root).filter(name => /^[a-f0-9]{64}$/.test(name)).sort());
      expect(inventory.batches.map(entry => [entry.offset, entry.anchorCount])).toEqual([[0, 32], [32, 1]]);
      expect(inventory.anchorCount).toBe(33);
    } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
  });
  it("derives original anchors independently and does not mutate or retain mutable source references", () => {
    const input = fixture(1), before = structuredClone(input), inventory = buildPreservedWfExpectedInventoryV1(input);
    const source = input.sourceCorpus[0]!;
    expect(inventory.batches[0]!.expectedAnchors).toEqual([{ anchorId: computeSemanticSha256Hex({
      schemaVersion: "waia.trader.wf_predictive_anchor.v2", surfaceKey: "BTCUSDT:30",
      closedBarEpochMs: source.closedBarEpochMs, barContentDigest: source.barContentDigest,
      evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex }), observedReturn: 0 }]);
    expect(input).toEqual(before);
    source.realizedVol20m_1m = 2;
    expect(Object.is((inventory.batches[0]!.checkpoint.input as { batch: { realizedVol20m_1m: number }[] })
      .batch[0]!.realizedVol20m_1m, -0)).toBe(true);
    expect(inventory).toMatchObject({ authorityGranted: false, inputProvenance: "NOT_ESTABLISHED",
      artifactAuthentication: "NOT_ESTABLISHED", scientificCompleteness: "NOT_ESTABLISHED" });
  });
  it.each(["runtime", "release", "receipt", "reorder", "volatility"])("binds changed original %s", change => {
    const input = fixture(), before = buildPreservedWfExpectedInventoryV1(input);
    if (change === "runtime") input.origin.runtime.node = "v1.2.3";
    if (change === "release") input.origin.releaseSha = "b".repeat(40);
    if (change === "receipt") input.evaluationPartitionReceiptDigestHex = hash("new-receipt");
    if (change === "reorder") input.sourceCorpus = [...input.sourceCorpus].reverse();
    if (change === "volatility") input.sourceCorpus[0]!.realizedVol20m_1m = 0;
    const after = buildPreservedWfExpectedInventoryV1(input);
    expect(after.batches[0]!.key).not.toBe(before.batches[0]!.key);
    if (change === "runtime" || change === "release")
      expect(after.batches[0]!.expectedAnchors).toEqual(before.batches[0]!.expectedAnchors);
  });
  it("refuses duplicated original anchors across batch boundaries", () => {
    const input = fixture(); input.sourceCorpus = [...input.sourceCorpus.slice(0, 32), input.sourceCorpus[0]!];
    expect(() => buildPreservedWfExpectedInventoryV1(input)).toThrow("DUPLICATE_ANCHOR");
  });
  it.each(["empty", "sparse-corpus", "sparse-outcome", "missing-field", "undefined-field", "extra-field", "wrong-symbol", "nonfinite"])(
    "refuses %s without normalizing original input", change => {
      const input = fixture(1);
      if (change === "empty") input.sourceCorpus = [];
      if (change === "sparse-corpus") input.sourceCorpus = Array(1);
      if (change === "sparse-outcome") input.sourceCorpus[0]!.outcome13d = Array(13);
      if (change === "missing-field") Reflect.deleteProperty(input.sourceCorpus[0]!, "realizedVol20m_1m");
      if (change === "undefined-field") Object.assign(input.sourceCorpus[0]!, { realizedVol20m_1m: undefined });
      if (change === "extra-field") Object.assign(input.sourceCorpus[0]!, { optional: undefined });
      if (change === "wrong-symbol") input.sourceCorpus[0]!.symbol = "ETHUSDT";
      if (change === "nonfinite") input.sourceCorpus[0]!.realizedVol20m_1m = Infinity;
      expect(() => buildPreservedWfExpectedInventoryV1(input)).toThrow("REFUSED");
    });
  it("refuses source accessors without executing them", () => {
    const input = fixture(1), getter = vi.fn(() => 0.01);
    Object.defineProperty(input.sourceCorpus[0], "realizedVol20m_1m", { get: getter, enumerable: true });
    expect(() => buildPreservedWfExpectedInventoryV1(input)).toThrow("ACCESSOR");
    expect(getter).not.toHaveBeenCalled();
  });
  it("refuses hidden array method overrides without invoking caller code", () => {
    const input = fixture(1), slice = vi.fn(() => []);
    Object.defineProperty(input.sourceCorpus, "slice", { value: slice });
    expect(() => buildPreservedWfExpectedInventoryV1(input)).toThrow("ARRAY");
    expect(slice).not.toHaveBeenCalled();
  });
});

describe("pure WF whole-inventory key coverage", () => {
  it("reports exact supplied coverage irrespective of observed order, without proving authentication/completeness", () => {
    const inventory = buildPreservedWfExpectedInventoryV1(fixture());
    const observed = inventory.batches.map(({ key, anchorCount }) => ({ key, anchorCount })).reverse();
    expect(comparePreservedWfInventoryCoverageV1(inventory, observed)).toMatchObject({
      status: "EXACT_SUPPLIED_KEY_COVERAGE_NOT_AUTHENTICATED", expectedAnchorCount: 33, observedAnchorCount: 33,
      expectedBatchCount: 2, observedBatchCount: 2, missingKeys: [], unexpectedKeys: [],
      duplicateExpectedKeys: [], duplicateObservedKeys: [], countMismatches: [],
      authorityGranted: false, inputProvenance: "NOT_ESTABLISHED", artifactAuthentication: "NOT_ESTABLISHED",
      scientificCompleteness: "NOT_ESTABLISHED" });
  });
  it("reports missing, unexpected, duplicate and wrong-count observations together", () => {
    const inventory = buildPreservedWfExpectedInventoryV1(fixture()), key = inventory.batches[0]!.key;
    const result = comparePreservedWfInventoryCoverageV1(inventory, [
      { key, anchorCount: 31 }, { key, anchorCount: 32 }, { key: hash("unexpected"), anchorCount: 1 }]);
    expect(result).toMatchObject({ status: "SUPPLIED_KEY_COVERAGE_MISMATCH",
      missingKeys: [inventory.batches[1]!.key], unexpectedKeys: [hash("unexpected")],
      duplicateObservedKeys: [key], countMismatches: [{ key, expected: 32, observed: 31 }] });
  });
  it("reports duplicated expected keys and refuses to certify an empty expected inventory", () => {
    const inventory = buildPreservedWfExpectedInventoryV1(fixture(1)), entry = inventory.batches[0]!;
    expect(comparePreservedWfInventoryCoverageV1({ ...inventory, batches: [entry, entry] },
      [{ key: entry.key, anchorCount: 1 }])).toMatchObject({ status: "SUPPLIED_KEY_COVERAGE_MISMATCH",
      duplicateExpectedKeys: [entry.key] });
    expect(comparePreservedWfInventoryCoverageV1({ ...inventory, batches: [] }, []).status)
      .toBe("SUPPLIED_KEY_COVERAGE_MISMATCH");
  });
});
