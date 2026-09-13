// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readdirSync, readFileSync, realpathSync,
  rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { verifyPreservedScientificPackageHydrationV1,
  type ExpectedPreservedScientificPackageV1 } from "../../scripts/trader/scientific-checkpoint-audit-v1";
import { deriveScientificCheckpointKeyV1 } from "../../scripts/trader/scientific-checkpoint-key-v1";
import * as storeModule from "../../scripts/trader/scientific-checkpoint-store-v1";
import * as forecast from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import * as bootstrap from "@/lib/trader/intelligence/forecast-v2/stationary-bootstrap-v1";
import * as codec from "@/lib/trader/intelligence/forecast-v2/predictive-package-codec-v1";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { computeReplicaRootFamilyIdentityDigest, computePredictivePackageGenerationIdentityDigest,
  computeRuntimeContractDigest } from "@/lib/trader/intelligence/forecast-v2/identity-digests";

const sha = "b".repeat(40), hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
let root: string;
beforeEach(() => {
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  root = realpathSync(mkdtempSync(join(tmpdir(), "waia-package-hydration-")));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const family = buildHistoricalForecastFamilyV2({ organizationId: "00000000-0000-4000-8000-000000000001",
    symbol: "BTCUSDT", primaryHorizonMinutes: 30, developmentDatasetDigestHex: "a".repeat(64), releaseSha: sha });
  const sourceCorpus: forecast.SourceAnchor[] = Array.from({ length: 120 }, (_, i) => ({ venue: "htx", market: "spot",
    symbol: "BTCUSDT", closedBarEpochMs: 1_700_000_000_000 + i * 60_000, barContentDigest: hash(String(i)),
    realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
    outcome13d: [i === 0 ? -0 : 0.001, 0.002, 0.003, ((i % 11) - 5) / 1000, 0.004, 0.005, 0.006, 100, 101, 102, 103, 104, 105] }));
  const input = { family, sourceCorpus, kConfigDec: 2, mConfigDec: 20 };
  // Synthetic construction belongs only to fixture preparation. The verifier is
  // given expectations captured here, not discovered from its inspected store.
  const pkg = forecast.buildPredictivePackageV1(input), encoded = codec.encodePredictivePackageV1(pkg);
  storeModule.createScientificCheckpointStoreV1(root, sha).package(input, () => pkg);
  const originalRuntime = { node: process.version, os: process.platform, arch: process.arch };
  const expected: ExpectedPreservedScientificPackageV1 = {
    checkpointKey: deriveScientificCheckpointKeyV1({ releaseSha: sha, runtime: originalRuntime,
      stage: "predictive-package", kind: "package", input }),
    family, originalRuntime, familyIdentityDigestHex: pkg.replicaRootFamilyIdentityDigest.toString("hex"),
    runtimeContractDigestHex: pkg.runtimeContractDigest.toString("hex"),
    generationDigestHex: pkg.predictivePackageGenerationIdentityDigest.toString("hex"),
    contentDigestHex: pkg.predictivePackageContentDigest.toString("hex"),
    manifestDigestHex: encoded.manifest.manifestDigestHex, manifestFileDigestHex: hash(serialize(encoded.manifest)),
    targetGridDigestHex: pkg.terminalTargetGridIdentityDigestHex, sourceCount: sourceCorpus.length,
    chunkCount: encoded.chunks.length, kConfigDec: 2, mConfigDec: 20, alphaEpiConfigScale8: "0.10000000",
  };
  return { expected, path: join(root, expected.checkpointKey) };
}
function snapshot(path: string): unknown {
  const st = lstatSync(path);
  return { mode: st.mode, uid: st.uid, size: st.size, mtime: st.mtimeMs, ctime: st.ctimeMs,
    content: st.isDirectory() ? readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]) : hash(readFileSync(path)) };
}
function prohibitGeneration() {
  const refuse = () => { throw new Error("UNEXPECTED_SCIENTIFIC_GENERATION"); };
  const spies = [vi.spyOn(storeModule, "createScientificCheckpointStoreV1").mockImplementation(refuse),
    vi.spyOn(forecast, "buildPredictivePackageV1").mockImplementation(refuse),
    vi.spyOn(forecast, "issueForecastV1").mockImplementation(refuse),
    vi.spyOn(bootstrap, "stationaryBootstrapV1").mockImplementation(refuse)];
  return () => { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); };
}
function resealManifest(path: string, manifest: codec.PredictivePackageManifestV1, expected: ExpectedPreservedScientificPackageV1) {
  const h = createHash("sha256");
  h.update(JSON.stringify([manifest.version, manifest.organizationId, manifest.generationDigestHex, manifest.contentDigestHex,
    manifest.chunkByteLimit, manifest.sourceCount, manifest.replicaCount, manifest.chunks.length]) + "\n");
  for (const c of manifest.chunks) h.update(JSON.stringify([c.ordinal, c.byteLength, c.recordCount, c.sha256]) + "\n");
  manifest.manifestDigestHex = h.digest("hex");
  const bytes = serialize(manifest), sealPath = join(path, "seal.json");
  const envelope = JSON.parse(readFileSync(sealPath, "utf8")), seal = JSON.parse(envelope.body);
  seal.payloadDigest = manifest.manifestDigestHex; seal.manifestFileDigest = hash(bytes);
  envelope.body = JSON.stringify(seal);
  envelope.signature = createHmac("sha256", readFileSync(join(root, ".seal-key"))).update(envelope.body).digest("hex");
  writeFileSync(join(path, "manifest.bin"), bytes); writeFileSync(sealPath, JSON.stringify(envelope));
  expected.manifestDigestHex = manifest.manifestDigestHex; expected.manifestFileDigestHex = hash(bytes);
}

describe("read-only selected original package full hydration", () => {
  it("authenticates and hydrates all chunks, preserves bytes/metadata, and exports only bounded summary", () => {
    const { expected } = fixture(), before = snapshot(root), expectedBefore = structuredClone(expected);
    const assertNoGeneration = prohibitGeneration();
    const actualHydrate = codec.hydratePredictivePackageV1;
    const hydrate = vi.spyOn(codec, "hydratePredictivePackageV1").mockImplementation((manifest, chunks, identities) => {
      expect(Array.isArray(chunks)).toBe(false);
      expect(typeof chunks[Symbol.iterator]).toBe("function");
      return actualHydrate(manifest, chunks, identities);
    });
    const report = verifyPreservedScientificPackageHydrationV1(root, expected);
    expect(report).toMatchObject({ status: "AUTHENTICATED_FULL_CODEC_AND_EXPECTED_IDENTITIES_MATCH",
      chunksRead: expected.chunkCount, sourceCount: 120, replicaCount: 2, checkpointKey: expected.checkpointKey,
      authorityGranted: false, reuseAdmission: "NOT_GRANTED", convergenceSelection: "NOT_ESTABLISHED",
      inputKeyProvenance: "REQUIRES_SEPARATE_ORIGINAL_INPUT_MAPPING", originalSamplingExecution: "NOT_REPLAYED",
      forecastGeneration: "NOT_RUN", bootstrap: "NOT_RUN", checkpointWrites: "NOT_PERMITTED" });
    expect(report.chunksRead).toBeGreaterThan(1);
    expect(report.payloadBytes).toBeGreaterThan(0);
    const output = JSON.stringify(report);
    expect(output).not.toMatch(/organizationId|canonicalSourceCorpus|outcome13d|replicaArtifacts|pools|originalRuntime/);
    expect(output).not.toContain(expected.family.organizationId);
    expect(output).not.toContain(root);
    expect(output).not.toContain(readFileSync(join(root, ".seal-key")).toString("hex"));
    expect(hydrate).toHaveBeenCalledOnce();
    assertNoGeneration(); expect(snapshot(root)).toEqual(before); expect(expected).toEqual(expectedBefore);
  });
  it.each(["checkpointKey", "contentDigestHex", "manifestDigestHex", "manifestFileDigestHex", "targetGridDigestHex"] as const)(
    "refuses a wrong independent %s without generating or changing anything", field => {
      const { expected } = fixture(); expected[field] = "f".repeat(64);
      const before = snapshot(root), assertNoGeneration = prohibitGeneration();
      expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED");
      assertNoGeneration(); expect(snapshot(root)).toEqual(before);
    });
  it.each(["family", "runtime", "generation", "sourceCount", "chunkCount", "alpha", "m"])("refuses mismatched %s", field => {
    const { expected } = fixture();
    if (field === "family") expected.family = { ...expected.family, organizationId: "00000000-0000-4000-8000-000000000002" };
    if (field === "runtime") expected.originalRuntime.node = "v1.2.3";
    if (field === "generation") expected.generationDigestHex = "f".repeat(64);
    if (field === "sourceCount") expected.sourceCount++;
    if (field === "chunkCount") expected.chunkCount++;
    if (field === "alpha") expected.alphaEpiConfigScale8 = "0.20000000";
    if (field === "m") expected.mConfigDec++;
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED");
  });
  it.each(["seal", "manifest", "last-chunk-corrupt", "last-chunk-missing", "last-chunk-truncated", "extra-chunk", "symlink"])(
    "refuses %s with no fallback or secret-bearing errors", kind => {
      const { expected, path } = fixture(), last = join(path, `${expected.chunkCount - 1}.chunk`);
      if (kind === "seal") writeFileSync(join(path, "seal.json"), "PRIVATE_CORRUPTION");
      if (kind === "manifest") writeFileSync(join(path, "manifest.bin"), "PRIVATE_CORRUPTION");
      if (kind === "last-chunk-corrupt") writeFileSync(last, "PRIVATE_CORRUPTION");
      if (kind === "last-chunk-missing") rmSync(last);
      if (kind === "last-chunk-truncated") writeFileSync(last, readFileSync(last).subarray(0, 12));
      if (kind === "extra-chunk") writeFileSync(join(path, `${expected.chunkCount}.chunk`), "PRIVATE_CORRUPTION", { mode: 0o600 });
      if (kind === "symlink") { rmSync(last); symlinkSync(join(path, "0.chunk"), last); }
      const assertNoGeneration = prohibitGeneration();
      let message = "";
      try { verifyPreservedScientificPackageHydrationV1(root, expected); } catch (error) { message = (error as Error).message; }
      expect(message).toMatch(/^SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED:[A-Z_]+$/);
      expect(message).not.toContain(root); expect(message).not.toContain("PRIVATE_CORRUPTION"); assertNoGeneration();
    });
  it("performs codec structure validation even when a malformed draw is fully reauthenticated", () => {
    const { expected, path } = fixture();
    const manifest = deserialize(readFileSync(join(path, "manifest.bin"))) as codec.PredictivePackageManifestV1;
    let edited = false;
    for (const descriptor of manifest.chunks) {
      const chunkPath = join(path, `${descriptor.ordinal}.chunk`), lines = readFileSync(chunkPath, "utf8").trimEnd().split("\n");
      for (let index = 0; index < lines.length; index++) {
        const row = JSON.parse(lines[index]!);
        if (row[0] === "a" && row[1]?.[0]?.[1] === "draw") {
          const invalid = Buffer.alloc(8); invalid.writeDoubleBE(expected.sourceCount + 1);
          row[1][2] = ["n", invalid.toString("hex")]; lines[index] = JSON.stringify(row); edited = true; break;
        }
      }
      if (edited) {
        const bytes = Buffer.from(lines.join("\n") + "\n"); writeFileSync(chunkPath, bytes);
        descriptor.byteLength = bytes.length; descriptor.sha256 = hash(bytes); break;
      }
    }
    expect(edited).toBe(true); resealManifest(path, manifest, expected);
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED:PACKAGE_HYDRATION");
  });
  it("checks hydrated original family/runtime even when expected metadata is internally coherent", () => {
    const { expected } = fixture();
    expected.originalRuntime.node = "v1.2.3";
    expected.runtimeContractDigestHex = computeRuntimeContractDigest({ osClass: expected.originalRuntime.os,
      arch: expected.originalRuntime.arch, nodeVersionExact: expected.originalRuntime.node,
      codeReleaseSha: sha, modelTransformVersion: expected.family.modelTransformVersion }).toString("hex");
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED:PACKAGE_EXPECTED_IDENTITY");
    expected.family = { ...expected.family, organizationId: "00000000-0000-4000-8000-000000000002" };
    expected.familyIdentityDigestHex = computeReplicaRootFamilyIdentityDigest(expected.family).toString("hex");
    expected.generationDigestHex = computePredictivePackageGenerationIdentityDigest({ replicaRootFamilyIdentityDigestHex:
      expected.familyIdentityDigestHex, kConfigDec: expected.kConfigDec, mConfigDec: expected.mConfigDec,
      alphaEpiConfigScale8: expected.alphaEpiConfigScale8 }).toString("hex");
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED:PACKAGE_EXPECTED_SEAL");
  });
  it("validates bounded data-only expectations before opening the tree", () => {
    const { expected } = fixture(), getter = vi.fn(() => "private");
    Object.defineProperty(expected, "checkpointKey", { enumerable: true, get: getter });
    expect(() => verifyPreservedScientificPackageHydrationV1(join(root, "absent"), expected)).toThrow("REFUSED:PACKAGE_EXPECTATION");
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(["large-family", "large-count", "unknown-field", "proxy", "negative-alpha"])("rejects %s metadata", kind => {
    let { expected } = fixture();
    if (kind === "large-family") expected.family = { ...expected.family, symbol: "X".repeat(257) };
    if (kind === "large-count") expected.sourceCount = 2_000_001;
    if (kind === "unknown-field") Object.assign(expected, { extra: "private" });
    if (kind === "proxy") expected = new Proxy(expected, { get() { throw new Error("PRIVATE_PROXY"); } });
    if (kind === "negative-alpha") expected.alphaEpiConfigScale8 = "-0.10000000";
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED:PACKAGE_EXPECTATION");
  });
  it("requires CLI/private storage and never creates a missing tree or key", () => {
    const { expected } = fixture();
    vi.stubEnv("WAIA_TRADER_CLI", "0");
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED:CONFIG");
    vi.stubEnv("WAIA_TRADER_CLI", "1");
    chmodSync(root, 0o755);
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED:PRIVATE_PATH");
    chmodSync(root, 0o700); rmSync(join(root, ".seal-key"));
    const before = snapshot(root);
    expect(() => verifyPreservedScientificPackageHydrationV1(root, expected)).toThrow("REFUSED");
    expect(() => verifyPreservedScientificPackageHydrationV1(join(root, "missing"), expected)).toThrow("REFUSED");
    expect(snapshot(root)).toEqual(before);
  });
});
