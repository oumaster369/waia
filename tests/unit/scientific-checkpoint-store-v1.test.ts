// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { serialize } from "node:v8";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { withScientificCheckpointsV1 } from "@/lib/trader/historical-simulation-v2/scientific-checkpoint-context-v1";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildExecutableForecastReplayEvidenceV2 } from
  "@/lib/trader/research/execopp-qualification/km-four-surface-production-bootstrap-v2";
import { buildPredictivePackageV1, issueForecastV1, type SourceAnchor } from
  "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";

const sha = "b".repeat(40);
const family = buildHistoricalForecastFamilyV2({ organizationId: "00000000-0000-4000-8000-000000000001",
  symbol: "BTCUSDT", primaryHorizonMinutes: 30, developmentDatasetDigestHex: "a".repeat(64), releaseSha: sha });
const corpus: SourceAnchor[] = Array.from({ length: 120 }, (_, i) => ({ venue: "htx", market: "spot", symbol: "BTCUSDT",
  closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
  barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
  realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
  outcome13d: [i === 0 ? -0 : 0.001, 0.002, 0.003, ((i % 11) - 5) / 1000, 0.004, 0.005, 0.006, 100, 101, 102, 103, 104, 105],
}));
const input = { family, sourceCorpus: corpus, kConfigDec: 2, mConfigDec: 20 };
let root: string;
beforeEach(() => { vi.stubEnv("WAIA_TRADER_CLI", "1"); root = realpathSync(mkdtempSync(join(tmpdir(), "waia-checkpoint-test-"))); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true }); });
const target = () => join(root, readdirSync(root).find(name => /^[a-f0-9]{64}$/.test(name))!);

describe("private scientific computation checkpoints", () => {
  it("retains a real package after SIGKILL and hydrates it in a separate process without recomputation", () => {
    const program = `
      const { deserialize } = require('node:v8');
      const { createScientificCheckpointStoreV1 } = require('./scripts/trader/scientific-checkpoint-store-v1.ts');
      const { buildPredictivePackageV1 } = require('./lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1.ts');
      const input = deserialize(Buffer.from(process.env.CHECKPOINT_TEST_INPUT, 'base64'));
      const store = createScientificCheckpointStoreV1(process.env.CHECKPOINT_TEST_ROOT, input.family.codeReleaseSha);
      const pkg = store.package(input, () => {
        if (process.env.CHECKPOINT_TEST_RESUME === '1') throw Error('UNEXPECTED_RECOMPUTATION');
        return buildPredictivePackageV1(input);
      });
      if (process.env.CHECKPOINT_TEST_RESUME !== '1') process.kill(process.pid, 'SIGKILL');
      process.stdout.write(JSON.stringify({ digest: pkg.predictivePackageContentDigest.toString('hex'),
        negativeZero: Object.is(pkg.canonicalSourceCorpus[0].outcome13d[0], -0) }));
    `;
    const options = { cwd: process.cwd(), timeout: 15_000, encoding: "utf8" as const,
      env: { ...process.env, WAIA_TRADER_CLI: "1", CHECKPOINT_TEST_ROOT: root,
        CHECKPOINT_TEST_INPUT: serialize(input).toString("base64") } };
    const interrupted = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "-e", program], options);
    expect(interrupted.stderr).toBe(""); expect(interrupted.signal).toBe("SIGKILL");
    const resumed = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "-e", program],
      { ...options, env: { ...options.env, CHECKPOINT_TEST_RESUME: "1" } });
    expect(resumed.stderr).toBe(""); expect(resumed.status).toBe(0);
    expect(JSON.parse(resumed.stdout)).toEqual({
      digest: buildPredictivePackageV1(input).predictivePackageContentDigest.toString("hex"), negativeZero: true,
    });
  });
  it("never admits a directory killed before atomic publication and preserves its partial evidence", () => {
    const program = `
      const fs = require('node:fs');
      fs.renameSync = () => process.kill(process.pid, 'SIGKILL');
      const { createScientificCheckpointStoreV1 } = require('./scripts/trader/scientific-checkpoint-store-v1.ts');
      createScientificCheckpointStoreV1(process.env.CHECKPOINT_TEST_ROOT, '${sha}')
        .evidence('partial', { organizationId: 'one' }, () => ({ status: 'not-published' }));
    `;
    const result = spawnSync(process.execPath, ["--import", "tsx", "--conditions=react-server", "-e", program], {
      cwd: process.cwd(), timeout: 15_000, encoding: "utf8",
      env: { ...process.env, WAIA_TRADER_CLI: "1", CHECKPOINT_TEST_ROOT: root },
    });
    expect(result.stderr).toBe(""); expect(result.signal).toBe("SIGKILL");
    const partial = readdirSync(root).find(name => name.includes(".partial-"));
    expect(partial).toBeDefined(); expect(readdirSync(root).some(name => /^[a-f0-9]{64}$/.test(name))).toBe(false);
    const build = vi.fn(() => ({ status: "recomputed-unfinished-only" }));
    expect(createScientificCheckpointStoreV1(root, sha).evidence("partial", { organizationId: "one" }, build))
      .toEqual({ status: "recomputed-unfinished-only" });
    expect(build).toHaveBeenCalledOnce(); expect(readdirSync(root)).toContain(partial);
  });
  it("reuses completed real KM replay batches after a later failure with identical results", () => {
    const replayInput = { family, developmentCorpus: corpus,
      selectedAnchors: corpus.slice(0, 34).map(source => ({ symbol: "BTCUSDT", primaryHorizonMinutes: 30 as const,
        anchorEpochMin: source.closedBarEpochMs / 60_000 })),
      economics: { notionalUsdt: 1000, costRate: 0.001, slippageBufferUsdt: 0.05, nRefUsdt: 1000 } };
    const expected = buildExecutableForecastReplayEvidenceV2(replayInput);
    const store = createScientificCheckpointStoreV1(root, sha);
    const original = store.evidence.bind(store); let batchCalls = 0;
    vi.spyOn(store, "evidence").mockImplementation((stage, key, build) => {
      if (stage === "km-replay-batch-v1" && ++batchCalls === 2) throw Error("INTERRUPTED_AFTER_FIRST_BATCH");
      return original(stage, key, build);
    });
    expect(() => withScientificCheckpointsV1(store, () => buildExecutableForecastReplayEvidenceV2(replayInput)))
      .toThrow("INTERRUPTED_AFTER_FIRST_BATCH");
    const resumed = createScientificCheckpointStoreV1(root, sha), load = resumed.evidence.bind(resumed);
    let batchesComputed = 0;
    vi.spyOn(resumed, "evidence").mockImplementation((stage, key, build) => load(stage, key, () => {
      if (stage === "km-replay-batch-v1") batchesComputed++;
      return build();
    }));
    expect(withScientificCheckpointsV1(resumed, () => buildExecutableForecastReplayEvidenceV2(replayInput))).toEqual(expected);
    expect(batchesComputed).toBe(1); // Only the final two anchors, not the completed first 32.
  }, 30_000);
  it("survives a later failure and loads a package in a new store without calling the builder", () => {
    const expected = buildPredictivePackageV1(input);
    const first = createScientificCheckpointStoreV1(root, sha);
    const build = vi.fn(() => expected);
    expect(() => { first.package(input, build); throw new Error("later journal/transaction failed"); }).toThrow("later");
    const resumed = createScientificCheckpointStoreV1(root, sha);
    const mustNotRecompute = vi.fn(() => { throw new Error("recomputed"); });
    const actual = resumed.package(input, mustNotRecompute);
    expect(actual).toEqual(expected); expect(build).toHaveBeenCalledOnce(); expect(mustNotRecompute).not.toHaveBeenCalled();
    const forecast = { anchorClosedBarEpochMs: corpus[0]!.closedBarEpochMs,
      anchorRealizedVol20m_1m: corpus[0]!.realizedVol20m_1m, executionHorizonMinutes: family.executionHorizonMinutes,
      normalizationVersionDigestHex: family.normalizationVersionDigestHex };
    expect(issueForecastV1({ ...forecast, pkg: actual })).toEqual(issueForecastV1({ ...forecast, pkg: expected }));
    expect(statSync(root).mode & 0o777).toBe(0o700);
    expect(statSync(join(root, ".seal-key")).mode & 0o777).toBe(0o600);
  });
  it("routes the real package entrypoint through the scoped store but not outside CLI scope", () => {
    const store = createScientificCheckpointStoreV1(root, sha);
    const spy = vi.spyOn(store, "package");
    const expected = buildPredictivePackageV1(input);
    expect(spy).not.toHaveBeenCalled();
    const actual = withScientificCheckpointsV1(store, () => buildPredictivePackageV1(input));
    expect(actual).toEqual(expected); expect(spy).toHaveBeenCalledOnce();
  });
  it("preserves completed evidence and negative scientific results, not interrupted partial work", async () => {
    const store = createScientificCheckpointStoreV1(root, sha);
    const completed = { status: "REJECTED", scores: [-0, -0.2, 0.4] };
    await store.evidenceAsync("trial", { organizationId: family.organizationId, inputs: [1, 2] }, async () => completed);
    await expect(store.evidenceAsync("interrupted", { inputs: [1] }, async () => { throw Error("interrupted"); })).rejects.toThrow("interrupted");
    const resumed = createScientificCheckpointStoreV1(root, sha);
    const build = vi.fn(async () => { throw Error("must not rerun completed trial"); });
    expect(await resumed.evidenceAsync("trial", { organizationId: family.organizationId, inputs: [1, 2] }, build)).toEqual(completed);
    expect(build).not.toHaveBeenCalled();
    const pending = vi.fn(() => 7); expect(resumed.evidence("interrupted", { inputs: [1] }, pending)).toBe(7);
    expect(pending).toHaveBeenCalledOnce();
  });
  it.each(["input", "organization", "release"])("does not reuse mismatched %s evidence", mismatch => {
    const store = createScientificCheckpointStoreV1(root, sha), original = { organizationId: "one", data: [1, 2] };
    store.evidence("evidence", original, () => 1);
    const changed = mismatch === "input" ? { ...original, data: [1, 3] } : mismatch === "organization" ? { ...original, organizationId: "two" } : original;
    const next = createScientificCheckpointStoreV1(root, mismatch === "release" ? "c".repeat(40) : sha);
    const build = vi.fn(() => 2); expect(next.evidence("evidence", changed, build)).toBe(2); expect(build).toHaveBeenCalledOnce();
  });
  it("rejects payload corruption and never silently recomputes a corrupted completed checkpoint", () => {
    const store = createScientificCheckpointStoreV1(root, sha); store.evidence("evidence", { a: 1 }, () => [1, 2]);
    writeFileSync(join(target(), "evidence.bin"), "tampered");
    const build = vi.fn(() => [9]); expect(() => store.evidence("evidence", { a: 1 }, build)).toThrow("PAYLOAD");
    expect(build).not.toHaveBeenCalled();
  });
  it("rejects edited manifest seals, missing package chunks and unsafe root permissions", () => {
    const store = createScientificCheckpointStoreV1(root, sha); store.package(input, () => buildPredictivePackageV1(input));
    const sealPath = join(target(), "seal.json"), original = readFileSync(sealPath);
    expect(original.length).toBeLessThan(2048);
    const seal = JSON.parse(original.toString()); seal.body = seal.body.replace('"package"', '"evidence"');
    writeFileSync(sealPath, JSON.stringify(seal));
    expect(() => store.package(input, () => { throw Error("recompute"); })).toThrow("SEAL");
    writeFileSync(sealPath, original);
    const manifestPath = join(target(), "manifest.bin"), manifest = readFileSync(manifestPath);
    writeFileSync(manifestPath, "tampered");
    expect(() => store.package(input, () => { throw Error("recompute"); })).toThrow("MANIFEST_PAYLOAD");
    writeFileSync(manifestPath, manifest);
    rmSync(join(target(), "0.chunk"));
    expect(() => store.package(input, () => { throw Error("recompute"); })).toThrow();
    chmodSync(root, 0o755); expect(() => createScientificCheckpointStoreV1(root, sha)).toThrow("PRIVATE_PATH");
  });
});
