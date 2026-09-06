/** Synthetic bounded real-issuer CPU sample; never qualification or a production ETA. */
import { createHash } from "node:crypto";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { MODEL_TRANSFORM_VERSION } from "../../lib/trader/intelligence/forecast-v2/constants";
import { buildPredictivePackageV1, issueForecastV1, type SourceAnchor } from
  "../../lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";

const count = Number(process.argv[2] ?? "64");
if (!Number.isSafeInteger(count) || count < 1 || count > 128) {
  throw new Error("Synthetic benchmark issuance count must be1..128");
}
const family = {
  organizationId: "00000000-0000-4000-8000-000000000001", venue: "htx", market: "spot", symbol: "BTCUSDT",
  primaryHorizonMinutes: 30, executionHorizonMinutes: 33, packageSubjectVersion: "pkg-subject/v1",
  terminalTargetDefinitionDigestHex: "a".repeat(64), executionOpportunityTargetDefinitionDigestHex: "b".repeat(64),
  modelTransformVersion: MODEL_TRANSFORM_VERSION,
  developmentDatasetDigestHex: createHash("sha256").update("DEE950-synthetic-issuance-cost").digest("hex"),
  featureVersion: "feature-engine/rv/v2", normalizationVersionDigestHex: "c".repeat(64),
  codeReleaseSha: "d".repeat(40),
};
const corpus: SourceAnchor[] = Array.from({ length: 360 }, (_, i) => ({
  venue: "htx", market: "spot", symbol: "BTCUSDT", closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
  barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
  realizedVol20m_1m: 0.01 + (i % 12) * 0.0015,
  outcome13d: Array.from({ length: 13 }, (_, c) => (i % (7 + c) - 3) * 0.0004),
}));
const fitStarted = performance.now();
const pkg = buildPredictivePackageV1({ family, sourceCorpus: corpus, kConfigDec: 10, mConfigDec: 80 });
const fitMs = performance.now() - fitStarted;
const trials = [];
let referenceDigest: string | undefined;
for (let trial = 0; trial < 3; trial++) {
  const output = createHash("sha256");
  const started = performance.now();
  for (let i = 0; i < count; i++) {
    const issuance = issueForecastV1({ pkg, anchorClosedBarEpochMs: 1_710_000_000_000 + i * 60_000,
      anchorRealizedVol20m_1m: 0.01 + (i % 12) * 0.0015, executionHorizonMinutes: 33,
      normalizationVersionDigestHex: family.normalizationVersionDigestHex });
    output.update(issuance.forecastContentDigestExec);
    output.update(issuance.forecastContentDigestTerminal);
    output.update(JSON.stringify(issuance.terminalScenarioMasses.probabilities));
  }
  const elapsedMs = performance.now() - started;
  const digest = output.digest("hex");
  if (referenceDigest && referenceDigest !== digest) throw new Error("Nonrepeatable issuer benchmark output");
  referenceDigest = digest;
  trials.push({ trial, elapsedMs, perIssuanceMs: elapsedMs / count, digest });
}
console.log(JSON.stringify({ kind: "synthetic-bounded-actual-issuer-not-qualification", runtime: process.version,
  platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model, k: 10, m: 80, count, fitMs, trials,
  limitations: "Synthetic360-source fixture, fixedK10/M80; not full-data fit/convergence, target-host capacity or production ETA" }, null, 2));
