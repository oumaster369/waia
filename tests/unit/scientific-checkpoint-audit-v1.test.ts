// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { deserialize, serialize } from "node:v8";
import { auditScientificCheckpointsV1, inspectScientificPackageHeadersV1, readScientificDiagnosticInputsV1 } from "../../scripts/trader/scientific-checkpoint-audit-v1";
import { projectScientificPackageHeaderV1 } from "../../scripts/trader/scientific-package-header-v1";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { scoreSavedForecastsDiagnosticV1, type ScoreDiagnosticBindingV1 } from "../../scripts/trader/scientific-score-diagnostic-v1";
import { computeTrialIdentityDigestV2 } from "@/lib/trader/research/benchmark/trial-identity-v2";
import { decodeScientificRecordV1 } from "../../scripts/trader/scientific-record-v1";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildPredictivePackageV1, type SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";

vi.mock("node:v8", async (original) => {
  const actual = await original<typeof import("node:v8")>();
  return { ...actual, deserialize: vi.fn(actual.deserialize) };
});
const sha = "b".repeat(40), hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
let root: string;
beforeEach(() => {
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  root = realpathSync(mkdtempSync(join(tmpdir(), "waia-audit-test-")));
  vi.mocked(deserialize).mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true }); rmSync(`${root}.binding.json`, { force: true }); });
function evidence(value: unknown = { secretMarker: "PRIVATE_PAYLOAD", outcome: "REJECTED" }) {
  createScientificCheckpointStoreV1(root, sha).evidence("test", { id: 1 }, () => value);
  return join(root, readdirSync(root).find((name) => /^[a-f0-9]{64}$/.test(name))!);
}
function packageFixture(count = 120) {
  const family = buildHistoricalForecastFamilyV2({ organizationId: "00000000-0000-4000-8000-000000000001",
    symbol: "BTCUSDT", primaryHorizonMinutes: 30, developmentDatasetDigestHex: "a".repeat(64), releaseSha: sha });
  const corpus: SourceAnchor[] = Array.from({ length: count }, (_, i) => ({ venue: "htx", market: "spot", symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000, barContentDigest: hash(Buffer.from(String(i))),
    realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
    outcome13d: [i === 0 ? -0 : 0.001, 0.002, 0.003, count > 2000 && i < count - 2000 ? -1 + 2 * i / (count - 2000 - 1) : ((i % 11) - 5) / 1000, 0.004, 0.005, 0.006, 100, 101, 102, 103, 104, 105] }));
  const input = { family, sourceCorpus: corpus, kConfigDec: 2, mConfigDec: 20 };
  createScientificCheckpointStoreV1(root, sha).package(input, () => buildPredictivePackageV1(input));
  return join(root, readdirSync(root).find((name) => existsSync(join(root, name, "manifest.bin")))!);
}

describe("read-only saved-score diagnostic", () => {
  function fixtures() {
    const p = packageFixture(2300), key = p.split("/").pop()!;
    const store = createScientificCheckpointStoreV1(root, sha);
    store.evidence("wf-forecast-batch-v1", { offset: 0 }, () => [
      { anchorId: "1".repeat(64), observedReturn: 0.8, challengerProbabilities: Array(7).fill(1 / 7) },
      { anchorId: "2".repeat(64), observedReturn: 0, challengerProbabilities: Array(7).fill(1 / 7) },
    ]);
    evidence();
    return { p, key };
  }
  function binding(input: ReturnType<typeof readScientificDiagnosticInputsV1>, key: string): ScoreDiagnosticBindingV1 {
    const common = hash(Buffer.from(["common-anchor-set/v1", ...input.forecasts.map(a => a.anchorId).sort()].join("\n")));
    const evaluation = "d".repeat(64), comparison = "wf-predictive:test:BTCUSDT:30";
    return { packageKey: key, releaseSha: sha, contentDigestHex: input.header.contentDigestHex,
      developmentDatasetDigestHex: input.header.developmentDatasetDigestHex, evaluationPartitionReceiptDigestHex: evaluation,
      comparisonFamilyId: comparison, forecastCount: 2,
      originalCompletedTrialIds: ["climatology/v1", "gaussian-pop-std/v2", "student-t5-nu5/v1"].map(baselineId => computeTrialIdentityDigestV2({
        scoringContractVersion: "multiclass-log-score/v1", evaluationPartitionReceiptDigestHex: evaluation,
        venue: "htx", market: "spot", symbol: "BTCUSDT", primaryHorizonMinutes: 30,
        modelTransformVersion: "rv-state-conditional-empirical-joint/v1", challengerPackageContentDigestHex: input.header.contentDigestHex,
        baselineId, metricId: "terminal-multiclass-log-score/v1", commonAnchorSetDigestHex: common,
        purgeDurationMinutes: 30, embargoDurationMinutes: 30, comparisonFamilyId: comparison }).toString("hex")) };
  }
  it("reads authenticated saved inputs, matches trial IDs and pinpoints zero rolling support without builders/bootstrap", () => {
    const { key } = fixtures(), before = snapshot(root);
    const input = readScientificDiagnosticInputsV1(root, key);
    expect(input.developmentReturns).toHaveLength(2300);
    expect(input.forecasts).toHaveLength(2); expect(input.otherEvidenceEntries).toBe(1);
    const report = scoreSavedForecastsDiagnosticV1(input, binding(input, key));
    expect(report).toMatchObject({ authorityGranted: false, bootstrap: "NOT_RUN", forecastGeneration: "NOT_RUN",
      qualification: "NOT_RUN", originalLogTrialIdentities: "MATCH" });
    expect(report.comparisons.find(c => c.baselineId === "rolling-w2000/v1")).toMatchObject({
      nonFiniteCount: 1, firstNonFinite: { anchorId: "1".repeat(64), baselineProbability: 0, baselineScore: "-Infinity", differential: "+Infinity" } });
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_PAYLOAD|organizationId|canonicalSourceCorpus/);
    expect(snapshot(root)).toEqual(before);
  });
  it.each([false, true])("actual score CLI preserves limited claims/refuses wrong trial identity (mismatch=%s)", mismatch => {
    const { key } = fixtures(), input = readScientificDiagnosticInputsV1(root, key), b = binding(input, key);
    if (mismatch) b.originalCompletedTrialIds[0] = "f".repeat(64);
    const config = `${root}.binding.json`;
    writeFileSync(config, JSON.stringify(b), { mode: 0o600 });
    const bundle = process.env.WAIA_SCORE_DIAGNOSTIC_TEST_BUNDLE;
    const entry = bundle ? [resolve(bundle)] : ["--import", "tsx", "--conditions=react-server",
      resolve("scripts/trader/scientific-score-diagnostic-v1.ts")];
    const result = spawnSync(process.execPath, [...entry, "--root", root, "--binding", config, "--quiescent-tree"],
      { encoding: "utf8", timeout: 20000, maxBuffer: 16000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(mismatch ? 1 : 0);
    if (mismatch) {
      expect(result.stdout).toBe(""); expect(result.stderr).toBe("SCIENTIFIC_SCORE_DIAGNOSTIC_REFUSED\n");
    } else {
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({ authorityGranted: false, originalLogTrialIdentities: "MATCH",
        bootstrap: "NOT_RUN", forecastGeneration: "NOT_RUN", qualification: "NOT_RUN" });
    }
  });
  it.each(["trial", "count", "release", "grid"])("refuses mismatched %s without success output", what => {
    const { key } = fixtures(), input = readScientificDiagnosticInputsV1(root, key), b = binding(input, key);
    if (what === "trial") b.originalCompletedTrialIds[0] = "f".repeat(64);
    if (what === "count") b.forecastCount++;
    if (what === "release") b.releaseSha = "e".repeat(40);
    if (what === "grid") input.header = { ...input.header, targetGridDigestHex: "e".repeat(64) };
    expect(() => scoreSavedForecastsDiagnosticV1(input, b)).toThrow("DIAGNOSTIC_REFUSED");
  });
  it("rejects corrupted forecast payload before deserialization", () => {
    const { key } = fixtures();
    for (const n of readdirSync(root)) if (existsSync(join(root, n, "evidence.bin"))) writeFileSync(join(root, n, "evidence.bin"), "PRIVATE_BAD_DATA");
    expect(() => readScientificDiagnosticInputsV1(root, key)).toThrow("REFUSED:PAYLOAD");
  });
  it("rejects duplicate forecast identities and does not generate missing inputs", () => {
    const { key } = fixtures();
    createScientificCheckpointStoreV1(root, sha).evidence("wf-forecast-batch-v1", { offset: 32 }, () => [
      { anchorId: "1".repeat(64), observedReturn: 0.8, challengerProbabilities: Array(7).fill(1 / 7) }]);
    expect(() => readScientificDiagnosticInputsV1(root, key)).toThrow("REFUSED:FORECAST_ROW");
    expect(() => readScientificDiagnosticInputsV1(root, "0".repeat(64))).toThrow("REFUSED");
  });
  it("refuses sparse V8 forecast probability arrays before scoring", () => {
    const { key } = fixtures();
    const probabilities = Array<number>(7); probabilities[0] = 1;
    createScientificCheckpointStoreV1(root, sha).evidence("wf-forecast-batch-v1", { offset: 32 }, () => [
      { anchorId: "3".repeat(64), observedReturn: 0, challengerProbabilities: probabilities }]);
    expect(() => readScientificDiagnosticInputsV1(root, key)).toThrow("REFUSED:FORECAST_ROW");
  });
  it("decoder preserves negative zero and rejects duplicate keys, malformed tags and nonfinite numbers", () => {
    expect(Object.is(decodeScientificRecordV1('["n","8000000000000000"]'), -0)).toBe(true);
    for (const line of ['["n","7ff0000000000000"]', '["x",1]', '["o",[[["s","a"],true],[["s","a"],false]]]'])
      expect(() => decodeScientificRecordV1(line)).toThrow("RECORD_REFUSED");
  });
});
function editSeal(path: string, edit: (seal: Record<string, unknown>) => void, authenticate = true) {
  const envelope = JSON.parse(readFileSync(join(path, "seal.json"), "utf8"));
  const seal = JSON.parse(envelope.body); edit(seal); envelope.body = JSON.stringify(seal);
  if (authenticate) envelope.signature = createHmac("sha256", readFileSync(join(root, ".seal-key"))).update(envelope.body).digest("hex");
  writeFileSync(join(path, "seal.json"), JSON.stringify(envelope));
}
function snapshot(path: string): unknown {
  const st = lstatSync(path);
  return { mode: st.mode, uid: st.uid, size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs,
    content: st.isDirectory() ? readdirSync(path).sort().map((name) => [name, snapshot(join(path, name))]) : hash(readFileSync(path)) };
}

describe("authenticated package header discovery (not reuse admission)", () => {
  it("projects a real stored package without mutation, data export or replica hydration", () => {
    evidence(); packageFixture();
    const before = snapshot(root);
    const report = inspectScientificPackageHeadersV1(root);
    expect(report).toMatchObject({ authorityGranted: false, evidenceSeals: 1,
      payloadIntegrity: "NOT_RECHECKED", applicability: "NOT_ASSESSED",
      provenance: "OBSERVED_ARTIFACTS_NOT_INDEPENDENT_EXPECTATIONS",
      packages: [{ symbol: "BTCUSDT", primaryHorizonMinutes: 30, k: 2, m: 20, sourceCount: 120 }] });
    expect(report.packages).toHaveLength(1);
    expect(deserialize).toHaveBeenCalledTimes(1); // Authenticated manifest only.
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_PAYLOAD|organizationId|outcome13d|canonicalSourceCorpus/);
    expect(snapshot(root)).toEqual(before);
  });
  it("does not read evidence or later chunks and explicitly does not claim their integrity", () => {
    const e = evidence(), p = packageFixture();
    writeFileSync(join(e, "evidence.bin"), "UNVERIFIED_PRIVATE_PAYLOAD");
    writeFileSync(join(p, "1.chunk"), "UNVERIFIED_REPLICA");
    expect(inspectScientificPackageHeadersV1(root)).toMatchObject({ payloadIntegrity: "NOT_RECHECKED", evidenceSeals: 1 });
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED");
  });
  it.each(["seal", "manifest", "first-chunk"])("refuses changed %s before header interpretation", kind => {
    const p = packageFixture();
    writeFileSync(join(p, kind === "seal" ? "seal.json" : kind === "manifest" ? "manifest.bin" : "0.chunk"), "SECRET_CORRUPTION");
    expect(() => inspectScientificPackageHeadersV1(root)).toThrow("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED");
  });
  it("does not create a root/key or open symlinked first chunks", () => {
    expect(() => inspectScientificPackageHeadersV1(root)).toThrow("REFUSED");
    expect(readdirSync(root)).toEqual([]);
    const p = packageFixture(); rmSync(join(p, "0.chunk"));
    symlinkSync(join(p, "1.chunk"), join(p, "0.chunk"));
    expect(() => inspectScientificPackageHeadersV1(root)).toThrow("REFUSED:SYMLINK");
  });
  it("refuses header/manifest identity disagreement even with an authentic seal", () => {
    const p = packageFixture();
    // Existing fixture helper re-signs locally only; production never receives keys.
    editSeal(p, seal => { (seal.packageIdentity as Record<string, string>).contentDigestHex = "c".repeat(64); });
    expect(() => inspectScientificPackageHeadersV1(root)).toThrow("REFUSED");
  });
  it.each(["duplicate-field", "bad-number", "wrong-record", "missing-family", "oversize"])("rejects %s header projection", kind => {
    const p = packageFixture();
    const row = JSON.parse(readFileSync(join(p, "0.chunk"), "utf8").split("\n")[0]!);
    const fields = row[1][1][1];
    if (kind === "duplicate-field") fields.push(fields[0]);
    if (kind === "bad-number") fields.find((f: unknown[][]) => f[0]![1] === "kConfigDec")[1] = ["n", "7ff0000000000000"];
    if (kind === "wrong-record") row[1][0] = ["s", "anchor"];
    if (kind === "missing-family") fields.splice(fields.findIndex((f: unknown[][]) => f[0]![1] === "family"), 1);
    expect(() => projectScientificPackageHeaderV1(kind === "oversize" ? " ".repeat(65537) : JSON.stringify(row))).toThrow("HEADER_REFUSED");
  });
});

describe("read-only scientific checkpoint integrity audit", () => {
  it("audits real v1 package and evidence without writes, hydration or leaking payloads", () => {
    evidence(); packageFixture();
    const before = snapshot(root), log = vi.spyOn(console, "log"), error = vi.spyOn(console, "error");
    const result = auditScientificCheckpointsV1(root);
    expect(result).toMatchObject({ integrity: "VERIFIED_COMPLETED_ENTRIES", applicability: "NOT_ASSESSED", scientificValidity: "NOT_ASSESSED",
      computationCompleteness: "NOT_ASSESSED", completedEntries: 2, evidenceEntries: 1, packageEntries: 1, partialEntries: 0 });
    expect(result.chunks).toBeGreaterThan(1); expect(result.payloadBytes).toBeGreaterThan(0);
    expect(deserialize).toHaveBeenCalledTimes(1);
    expect(snapshot(root)).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_PAYLOAD");
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
  it("hashes multi-buffer evidence without deserializing or interpreting a negative result", () => {
    evidence(Buffer.alloc(2 * 1024 * 1024, 7));
    expect(auditScientificCheckpointsV1(root)).toMatchObject({ integrity: "VERIFIED_COMPLETED_ENTRIES", evidenceEntries: 1 });
    expect(deserialize).not.toHaveBeenCalled();
  });
  it("does not create an absent root or key", () => {
    expect(() => auditScientificCheckpointsV1(join(root, "absent"))).toThrow("REFUSED:IO");
    expect(readdirSync(root)).toEqual([]);
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:IO");
    expect(readdirSync(root)).toEqual([]);
  });
  it("preserves and excludes partial artifacts without claiming complete computation", () => {
    createScientificCheckpointStoreV1(root, sha);
    const partial = join(root, `${"a".repeat(64)}.partial-Ab12cd`);
    mkdirSync(partial, { mode: 0o700 }); writeFileSync(join(partial, "unfinished"), "kept", { mode: 0o600 });
    const before = snapshot(root);
    expect(auditScientificCheckpointsV1(root)).toMatchObject({ integrity: "NO_COMPLETED_ENTRIES", partialEntries: 1,
      computationCompleteness: "NOT_ASSESSED", completedEntries: 0 });
    expect(snapshot(root)).toEqual(before);
    evidence();
    expect(auditScientificCheckpointsV1(root)).toMatchObject({ integrity: "VERIFIED_COMPLETED_ENTRIES", partialEntries: 1,
      computationCompleteness: "NOT_ASSESSED", completedEntries: 1 });
  });
  it.each(["seal", "evidence", "manifest", "chunk"])("rejects tampered %s before unverified deserialization", (kind) => {
    const path = kind === "manifest" || kind === "chunk" ? packageFixture() : evidence();
    if (kind === "seal") editSeal(path, (seal) => { seal.payloadDigest = "0".repeat(64); }, false);
    else writeFileSync(join(path, kind === "evidence" ? "evidence.bin" : kind === "manifest" ? "manifest.bin" : "0.chunk"), "PRIVATE_TAMPER");
    expect(() => auditScientificCheckpointsV1(root)).toThrow("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED:");
    expect(deserialize).toHaveBeenCalledTimes(kind === "chunk" ? 1 : 0);
  });
  it.each(["missing", "extra", "noncanonical", "mixed"])("rejects %s package inventory", (kind) => {
    const path = packageFixture();
    if (kind === "missing") rmSync(join(path, "0.chunk"));
    else writeFileSync(join(path, kind === "extra" ? "999999.chunk" : kind === "noncanonical" ? "00.chunk" : "evidence.bin"), "extra", { mode: 0o600 });
    expect(() => auditScientificCheckpointsV1(root)).toThrow("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED:");
  });
  it.each(["format", "identity", "malformed", "oversize", "key-length"])("rejects %s metadata", (kind) => {
    const path = evidence();
    if (kind === "format") editSeal(path, (seal) => { seal.format = "unsupported"; });
    if (kind === "identity") editSeal(path, (seal) => { seal.key = "c".repeat(64); });
    if (kind === "malformed") writeFileSync(join(path, "seal.json"), "{PRIVATE_INVALID_JSON");
    if (kind === "oversize") truncateSync(join(path, "seal.json"), 16 * 1024 + 1);
    if (kind === "key-length") truncateSync(join(root, ".seal-key"), 31);
    expect(() => auditScientificCheckpointsV1(root)).toThrow("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED:");
    expect(deserialize).not.toHaveBeenCalled();
  });
  it("rejects oversized evidence before reading its contents", () => {
    const path = evidence(); truncateSync(join(path, "evidence.bin"), 64 * 1024 * 1024 + 1);
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:SIZE");
    expect(deserialize).not.toHaveBeenCalled();
  });
  it("rejects oversized binary manifests before deserialization", () => {
    const path = packageFixture(); truncateSync(join(path, "manifest.bin"), 64 * 1024 * 1024 + 1);
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:SIZE");
    expect(deserialize).not.toHaveBeenCalled();
  });
  it("authenticates evidence bytes without claiming a valid deserialized scientific result", () => {
    const path = evidence(), bytes = Buffer.from("PRIVATE_INVALID_V8_BYTES");
    writeFileSync(join(path, "evidence.bin"), bytes);
    editSeal(path, (seal) => { seal.payloadDigest = hash(bytes); });
    expect(auditScientificCheckpointsV1(root)).toMatchObject({ integrity: "VERIFIED_COMPLETED_ENTRIES", scientificValidity: "NOT_ASSESSED" });
    expect(deserialize).not.toHaveBeenCalled();
  });
  it("reports authenticated invalid binary manifests without exposing parser output", () => {
    const path = packageFixture(), bytes = Buffer.from("PRIVATE_INVALID_BINARY");
    writeFileSync(join(path, "manifest.bin"), bytes);
    editSeal(path, (seal) => { seal.manifestFileDigest = hash(bytes); });
    expect(() => auditScientificCheckpointsV1(root)).toThrow(/^SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED:MANIFEST$/);
    expect(deserialize).toHaveBeenCalledTimes(1);
  });
  it("reuses the codec manifest validation for authenticated malformed descriptors", () => {
    const path = packageFixture(), manifest = deserialize(readFileSync(join(path, "manifest.bin")));
    manifest.chunks[0].ordinal = 9;
    const bytes = serialize(manifest); writeFileSync(join(path, "manifest.bin"), bytes);
    editSeal(path, (seal) => { seal.manifestFileDigest = hash(bytes); });
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:MANIFEST");
  });
  it.each(["root", "entry", "key", "payload"])("rejects a %s symlink", (kind) => {
    const path = evidence();
    if (kind === "root") {
      const link = join(root, "linked-root"); symlinkSync(root, link);
      expect(() => auditScientificCheckpointsV1(link)).toThrow("REFUSED:SYMLINK");
    } else if (kind === "entry") {
      symlinkSync(path, join(root, "e".repeat(64)));
      expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:SYMLINK");
    } else {
      const target = kind === "key" ? join(root, ".seal-key") : join(path, "evidence.bin");
      rmSync(target); symlinkSync(join(path, "seal.json"), target);
      expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:SYMLINK");
    }
  });
  it.each(["root", "key", "payload"])("rejects unsafe %s permissions", (kind) => {
    const path = evidence();
    chmodSync(kind === "root" ? root : kind === "key" ? join(root, ".seal-key") : join(path, "evidence.bin"), 0o755);
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:PRIVATE_PATH");
  });
  it("requires explicit Node CLI scope and rejects broad or relative roots", () => {
    expect(() => auditScientificCheckpointsV1("/")).toThrow("REFUSED:CONFIG");
    expect(() => auditScientificCheckpointsV1("relative")).toThrow("REFUSED:CONFIG");
    vi.stubEnv("WAIA_TRADER_CLI", "0");
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:NODE_CLI");
  });
  it("rejects a tree owned by another user", () => {
    if (!process.getuid) return;
    vi.spyOn(process as { getuid: () => number }, "getuid").mockReturnValue(lstatSync(root).uid + 1);
    expect(() => auditScientificCheckpointsV1(root)).toThrow("REFUSED:PRIVATE_PATH");
  });
});
