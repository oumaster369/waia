// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import { buildPredictivePackageV1, type SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { createHash } from "node:crypto";

let root: string;
beforeEach(() => {
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  root = realpathSync(mkdtempSync(join(tmpdir(), "waia-audit-cli-test-")));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); });
function run(args: string[]) {
  // Optional explicit local artifact permits the same real subprocess acceptance
  // cases to exercise a standalone bundle. CI defaults to the source entrypoint.
  const bundle = process.env.WAIA_CHECKPOINT_AUDIT_TEST_BUNDLE;
  const entry = bundle ? [resolve(bundle)] : ["--import", "tsx", "--conditions=react-server",
    resolve("scripts/trader/scientific-checkpoint-audit-cli-v1.ts")];
  return spawnSync(process.execPath, [...entry, ...args],
  { encoding: "utf8", timeout: 15000, maxBuffer: 16 * 1024 });
}
describe("checkpoint audit operator CLI", () => {
  it("executes header-only mode against a real package with explicitly limited claims", () => {
    const sha = "a".repeat(40);
    const family = buildHistoricalForecastFamilyV2({ organizationId: "00000000-0000-4000-8000-000000000001",
      symbol: "BTCUSDT", primaryHorizonMinutes: 30, developmentDatasetDigestHex: "b".repeat(64), releaseSha: sha });
    const sourceCorpus: SourceAnchor[] = Array.from({ length: 120 }, (_, i) => ({ venue: "htx", market: "spot", symbol: "BTCUSDT",
      closedBarEpochMs: 1700000000000 + i * 60000, barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
      realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
      outcome13d: [0.001, 0.002, 0.003, ((i % 11) - 5) / 1000, 0.004, 0.005, 0.006, 100, 101, 102, 103, 104, 105] }));
    const input = { family, sourceCorpus, kConfigDec: 2, mConfigDec: 20 };
    createScientificCheckpointStoreV1(root, sha).package(input, () => buildPredictivePackageV1(input));
    const result = run(["--root", root, "--quiescent-tree", "--package-headers"]);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ format: "waia-scientific-package-headers/v1",
      authorityGranted: false, payloadIntegrity: "NOT_RECHECKED", applicability: "NOT_ASSESSED",
      packages: [{ symbol: "BTCUSDT", codeReleaseSha: sha, sourceCount: 120, k: 2, m: 20 }] });
    expect(result.stdout).not.toMatch(/organizationId|outcome13d|canonicalSourceCorpus/);
  });
  it("executes the real read-only verifier and limits the meaning of exit zero", () => {
    createScientificCheckpointStoreV1(root, "a".repeat(40)).evidence("test", { i: 1 }, () => "PRIVATE_PAYLOAD");
    const result = run(["--root", root, "--quiescent-tree"]);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ authorityGranted: false,
      integrity: "VERIFIED_COMPLETED_ENTRIES", completedEntries: 1,
      scientificValidity: "NOT_ASSESSED", applicability: "NOT_ASSESSED",
      computationCompleteness: "NOT_ASSESSED", quiescence: "OPERATOR_ASSERTED_NOT_INDEPENDENTLY_VERIFIED" });
    expect(result.stdout).not.toContain(root); expect(result.stdout).not.toContain("PRIVATE_PAYLOAD");
  });
  it("does not mistake an empty initialized store for verified completed entries", () => {
    createScientificCheckpointStoreV1(root, "a".repeat(40));
    const result = run(["--root", root, "--quiescent-tree"]);
    expect(result.status).toBe(2);
    expect(JSON.parse(result.stdout).integrity).toBe("NO_COMPLETED_ENTRIES");
  });
  it("refuses absent stores without creation or path leakage", () => {
    const result = run(["--root", join(root, "PRIVATE_ABSENT"), "--quiescent-tree"]);
    expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toBe("SCIENTIFIC_CHECKPOINT_AUDIT_REFUSED\n");
    expect(readdirSync(root)).toEqual([]);
  });
  it.each([[], ["--root", "PRIVATE_PATH"], ["--root", "PRIVATE_PATH", "--quiescent-tree", "--resume"]])(
    "rejects missing or extra arguments without touching storage: %j", (...args) => {
      const result = run(args);
      expect(result.status).toBe(64); expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("PRIVATE_PATH"); expect(readdirSync(root)).toEqual([]);
    });
});
