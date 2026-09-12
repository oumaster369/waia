import { types } from "node:util";
import { computeSemanticSha256Hex } from "../../lib/trader/intelligence/htr-semantic-canonical-json";
import { terminalRhFromOutcome13dV1 } from "../../lib/trader/intelligence/forecast-v2/exec-opp-outcome-materializer-v1";
import type { SourceAnchor } from "../../lib/trader/intelligence/forecast-v2/source-anchor-v1";
import { deriveScientificCheckpointKeyV1, type ExpectedScientificCheckpointV1 } from "./scientific-checkpoint-key-v1";

export type PreservedWfOriginalInputV1 = {
  origin: {
    organizationId: string;
    symbol: "BTCUSDT" | "ETHUSDT";
    primaryHorizonMinutes: 30 | 60;
    releaseSha: string;
    runtime: ExpectedScientificCheckpointV1["runtime"];
    packageGenerationDigestHex: string;
    packageContentDigestHex: string;
  };
  /** Independently supplied ORIGINAL receipt digest, never an evaluator receipt. */
  evaluationPartitionReceiptDigestHex: string;
  /** Exact original ordered source rows, including their original numeric values. */
  sourceCorpus: readonly SourceAnchor[];
};
const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function fail(reason: string): never { throw new Error(`PRESERVED_WF_INVENTORY_REFUSED:${reason}`); }
function dataObject(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || types.isProxy(value) ||
      Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length ||
      Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) fail("OBJECT");
  for (const key of keys) if (!("value" in Object.getOwnPropertyDescriptor(value, key)!)) fail("ACCESSOR");
}
function denseArray(value: unknown): asserts value is unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length || Object.keys(value).length !== value.length ||
      Object.getOwnPropertyNames(value).length !== value.length + 1) fail("ARRAY");
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) fail("ARRAY");
  }
}
const limitations = Object.freeze({
  authorityGranted: false as const,
  inputProvenance: "NOT_ESTABLISHED" as const,
  artifactAuthentication: "NOT_ESTABLISHED" as const,
  scientificCompleteness: "NOT_ESTABLISHED" as const,
});

/** Pure expected inventory only. It does not authenticate the supplied origin,
 * receipt or corpus. It neither discovers artifacts nor issues forecasts/scores.
 * Reject shape changes rather than silently normalizing the original store input.
 */
export function buildPreservedWfExpectedInventoryV1(input: PreservedWfOriginalInputV1) {
  dataObject(input, ["origin", "evaluationPartitionReceiptDigestHex", "sourceCorpus"]);
  dataObject(input.origin, ["organizationId", "symbol", "primaryHorizonMinutes", "releaseSha", "runtime",
    "packageGenerationDigestHex", "packageContentDigestHex"]);
  dataObject(input.origin.runtime, ["node", "os", "arch"]);
  const origin = input.origin;
  if (typeof origin.organizationId !== "string" || !origin.organizationId.trim() ||
      !["BTCUSDT", "ETHUSDT"].includes(origin.symbol) || ![30, 60].includes(origin.primaryHorizonMinutes) ||
      !digest(origin.packageGenerationDigestHex) || !digest(origin.packageContentDigestHex) ||
      !digest(input.evaluationPartitionReceiptDigestHex)) fail("ORIGIN");
  denseArray(input.sourceCorpus);
  if (!input.sourceCorpus.length) fail("EMPTY_CORPUS");
  const runtime = Object.freeze({ ...origin.runtime });
  const seen = new Set<string>();
  const batches: {
    key: string; checkpoint: ExpectedScientificCheckpointV1; offset: number; anchorCount: number;
    expectedAnchors: readonly Readonly<{ anchorId: string; observedReturn: number }>[];
  }[] = [];
  for (let offset = 0; offset < input.sourceCorpus.length; offset += 32) {
    const batch = input.sourceCorpus.slice(offset, offset + 32).map(source => {
      dataObject(source, ["venue", "market", "symbol", "closedBarEpochMs", "barContentDigest",
        "realizedVol20m_1m", "outcome13d"]);
      denseArray(source.outcome13d);
      if (source.venue !== "htx" || source.market !== "spot" || source.symbol !== origin.symbol ||
          !Number.isSafeInteger(source.closedBarEpochMs) || !digest(source.barContentDigest) ||
          !Number.isFinite(source.realizedVol20m_1m) || source.realizedVol20m_1m < 0 ||
          source.outcome13d.length !== 13 || source.outcome13d.some(value => !Number.isFinite(value))) fail("SOURCE");
      return Object.freeze({ ...source, outcome13d: Object.freeze([...source.outcome13d]) });
    });
    const checkpoint: ExpectedScientificCheckpointV1 = Object.freeze({
      releaseSha: origin.releaseSha, runtime, kind: "evidence", stage: "wf-forecast-batch-v1",
      input: Object.freeze({ organizationId: origin.organizationId, releaseSha: origin.releaseSha,
        generationDigest: origin.packageGenerationDigestHex, packageDigest: origin.packageContentDigestHex,
        evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex, offset,
        batch: Object.freeze(batch) }),
    });
    const key = deriveScientificCheckpointKeyV1(checkpoint);
    const expectedAnchors = batch.map(source => {
      const anchorId = computeSemanticSha256Hex({ schemaVersion: "waia.trader.wf_predictive_anchor.v2",
        surfaceKey: `${origin.symbol}:${origin.primaryHorizonMinutes}`,
        closedBarEpochMs: source.closedBarEpochMs, barContentDigest: source.barContentDigest,
        evaluationPartitionReceiptDigestHex: input.evaluationPartitionReceiptDigestHex });
      if (seen.has(anchorId)) fail("DUPLICATE_ANCHOR");
      seen.add(anchorId);
      return Object.freeze({ anchorId, observedReturn: terminalRhFromOutcome13dV1(source.outcome13d) });
    });
    batches.push(Object.freeze({ key, checkpoint, offset, anchorCount: batch.length,
      expectedAnchors: Object.freeze(expectedAnchors) }));
  }
  return Object.freeze({ schemaVersion: "preserved-wf-expected-inventory/v1" as const,
    status: "EXPECTED_FROM_SUPPLIED_INPUTS_ONLY" as const, ...limitations,
    anchorCount: input.sourceCorpus.length, batches: Object.freeze(batches) });
}
export type PreservedWfExpectedInventoryV1 = ReturnType<typeof buildPreservedWfExpectedInventoryV1>;

/** Pure comparison of caller-supplied keys/counts. Exact coverage is not seal,
 * payload, provenance or scientific validation. Observation order is irrelevant;
 * original corpus order is already bound inside each expected key.
 */
export function comparePreservedWfInventoryCoverageV1(
  inventory: PreservedWfExpectedInventoryV1,
  observed: readonly Readonly<{ key: string; anchorCount: number }>[],
) {
  denseArray(observed);
  const expected = new Map<string, number>();
  const duplicateExpectedKeys = new Set<string>();
  for (const batch of inventory.batches) {
    if (!digest(batch.key) || !Number.isSafeInteger(batch.anchorCount) || batch.anchorCount < 1 ||
        batch.anchorCount > 32) fail("EXPECTED_ENTRY");
    if (expected.has(batch.key)) duplicateExpectedKeys.add(batch.key);
    expected.set(batch.key, batch.anchorCount);
  }
  const counts = new Map<string, number>();
  const duplicateObservedKeys = new Set<string>();
  const countMismatches: { key: string; expected: number; observed: number }[] = [];
  for (const entry of observed) {
    dataObject(entry, ["key", "anchorCount"]);
    if (!digest(entry.key) || !Number.isSafeInteger(entry.anchorCount) || entry.anchorCount < 0) fail("OBSERVED_ENTRY");
    if (counts.has(entry.key)) duplicateObservedKeys.add(entry.key);
    counts.set(entry.key, entry.anchorCount);
    const wanted = expected.get(entry.key);
    if (wanted !== undefined && wanted !== entry.anchorCount)
      countMismatches.push(Object.freeze({ key: entry.key, expected: wanted, observed: entry.anchorCount }));
  }
  const missingKeys = [...expected.keys()].filter(key => !counts.has(key)).sort();
  const unexpectedKeys = [...counts.keys()].filter(key => !expected.has(key)).sort();
  const exact = expected.size > 0 && !missingKeys.length && !unexpectedKeys.length &&
    !duplicateExpectedKeys.size && !duplicateObservedKeys.size && !countMismatches.length;
  return Object.freeze({ schemaVersion: "preserved-wf-inventory-coverage/v1" as const,
    status: exact ? "EXACT_SUPPLIED_KEY_COVERAGE_NOT_AUTHENTICATED" as const : "SUPPLIED_KEY_COVERAGE_MISMATCH" as const,
    ...limitations, expectedBatchCount: inventory.batches.length, observedBatchCount: observed.length,
    expectedAnchorCount: [...expected.values()].reduce((sum, count) => sum + count, 0),
    observedAnchorCount: observed.reduce((sum, entry) => sum + entry.anchorCount, 0),
    missingKeys: Object.freeze(missingKeys), unexpectedKeys: Object.freeze(unexpectedKeys),
    duplicateExpectedKeys: Object.freeze([...duplicateExpectedKeys].sort()),
    duplicateObservedKeys: Object.freeze([...duplicateObservedKeys].sort()),
    countMismatches: Object.freeze(countMismatches.sort((a, b) => a.key.localeCompare(b.key))) });
}
