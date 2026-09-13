// @vitest-environment node
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serialize } from "node:v8";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";
import { createStrictScientificEvidenceResolverV1 } from "../../scripts/trader/scientific-evidence-resolver-v1";
import { deriveScientificCheckpointKeyV1 } from "../../scripts/trader/scientific-checkpoint-key-v1";
import {
  assertScientificEvidenceIdentityV1,
  isEvaluatorDurableBootstrapStageV1,
  resolveScientificEvidenceAsyncV1,
  resolveScientificEvidenceV1,
  resolveScientificPackageV1,
  scientificForecastEvidenceNamespaceV1,
  STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1,
  withStrictScientificResolverV1,
  type ScientificNamespaceIdentityV1,
} from "@/lib/trader/historical-simulation-v2/scientific-evidence-resolver-v1";
import { PREDICTIVE_TERMINAL_CHECKPOINT_STAGE } from "@/lib/trader/research/benchmark/cdf-evidence-protocol-v2";
import { buildHistoricalForecastFamilyV2 } from "@/lib/trader/historical-simulation-v2/forecast-family-bootstrap-v2";
import {
  buildPredictivePackageV1,
  issueForecastV1,
  type SourceAnchor,
} from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";
import { buildPredictiveTerminalReceiptAsyncV1 } from "@/lib/trader/research/execopp-qualification/scientific-admission-v2";
import { readFileSync } from "node:fs";

const originId: ScientificNamespaceIdentityV1 = Object.freeze({
  releaseSha: "90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67",
  runtime: Object.freeze({ node: "v22.23.2", os: "linux", arch: "x64" }),
});
const producerId: ScientificNamespaceIdentityV1 = Object.freeze({
  releaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runtime: Object.freeze({ node: "v22.23.2", os: "linux", arch: "x64" }),
});
const evaluatorId: ScientificNamespaceIdentityV1 = Object.freeze({
  releaseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  runtime: Object.freeze({ node: "v22.24.0", os: "darwin", arch: "arm64" }),
});

function tmpRoot(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
function listing(root: string): string[] {
  return readdirSync(root).sort();
}
function snapshot(root: string): string {
  return listing(root)
    .map((name) => {
      const st = statSync(join(root, name));
      return `${name}:${st.size}:${st.mtimeMs}:${st.mode}`;
    })
    .join("|");
}

const family = buildHistoricalForecastFamilyV2({
  organizationId: "00000000-0000-4000-8000-000000000001",
  symbol: "BTCUSDT",
  primaryHorizonMinutes: 30,
  developmentDatasetDigestHex: "a".repeat(64),
  releaseSha: originId.releaseSha,
});
const corpus: SourceAnchor[] = Array.from({ length: 120 }, (_, i) => ({
  venue: "htx",
  market: "spot",
  symbol: "BTCUSDT",
  closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
  barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
  realizedVol20m_1m: 0.005 + (i % 30) * 0.001,
  outcome13d: [
    i === 0 ? -0 : 0.001,
    0.002,
    0.003,
    ((i % 11) - 5) / 1000,
    0.004,
    0.005,
    0.006,
    100,
    101,
    102,
    103,
    104,
    105,
  ],
}));
const packageInput = { family, sourceCorpus: corpus, kConfigDec: 2, mConfigDec: 20 };

let originRoot: string;
let producerRoot: string;
let evaluatorRoot: string;

beforeEach(() => {
  vi.stubEnv("WAIA_TRADER_CLI", "1");
  originRoot = tmpRoot("waia-dee1004-o-");
  producerRoot = tmpRoot("waia-dee1004-p-");
  evaluatorRoot = tmpRoot("waia-dee1004-r-");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of [originRoot, producerRoot, evaluatorRoot]) {
    try {
      chmodSync(root, 0o700);
    } catch {
      /* already gone */
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function seed() {
  const originStore = createScientificCheckpointStoreV1(
    originRoot,
    originId.releaseSha,
    originId.runtime,
  );
  const producerStore = createScientificCheckpointStoreV1(
    producerRoot,
    producerId.releaseSha,
    producerId.runtime,
  );
  const evaluatorStore = createScientificCheckpointStoreV1(
    evaluatorRoot,
    evaluatorId.releaseSha,
    evaluatorId.runtime,
  );
  originStore.package(packageInput, () => buildPredictivePackageV1(packageInput));
  originStore.evidence("wf-forecast-batch-v1", { surface: "BTCUSDT:30", offset: 0 }, () => ({
    origin: true,
  }));
  producerStore.evidence("wf-forecast-batch-v1", { surface: "ETHUSDT:30", offset: 0 }, () => ({
    producer: true,
  }));
  evaluatorStore.evidence(PREDICTIVE_TERMINAL_CHECKPOINT_STAGE, { surface: "BTCUSDT:30" }, () => ({
    terminal: true,
  }));
  evaluatorStore.evidence("wf-predictive-bootstrap-range-v1", { range: [0, 31] }, () => ({
    range: true,
  }));
  chmodSync(originRoot, 0o500);
  chmodSync(producerRoot, 0o500);
}

function resolver(
  overrides: {
    origin?: typeof originId;
    producer?: typeof producerId | undefined;
    evaluator?: typeof evaluatorId;
  } = {},
) {
  return createStrictScientificEvidenceResolverV1({
    origin: { root: originRoot, identity: overrides.origin ?? originId },
    producer:
      overrides.producer === undefined && !("producer" in overrides)
        ? { root: producerRoot, identity: producerId }
        : overrides.producer
          ? { root: producerRoot, identity: overrides.producer }
          : undefined,
    evaluator: { root: evaluatorRoot, identity: overrides.evaluator ?? evaluatorId },
  });
}

describe("DEE-1004 strict dual-origin evidence resolver", () => {
  it("exposes no builder callback and never writes O or P during resolution", () => {
    const source = readFileSync(
      "lib/trader/historical-simulation-v2/scientific-evidence-resolver-v1.ts",
      "utf8",
    );
    const impl = readFileSync("scripts/trader/scientific-evidence-resolver-v1.ts", "utf8");
    expect(source).toContain("resolveScientificEvidenceV1");
    expect(source).toContain("resolveScientificEvidenceAsyncV1");
    expect(source).not.toMatch(/resolveScientificEvidenceV1[\s\S]{0,200}build\s*:/);
    expect(impl).not.toMatch(/\bmkdirSync\(|\bwriteFileSync\(|\bmkdtempSync\(/);
    seed();
    const originBefore = snapshot(originRoot);
    const producerBefore = snapshot(producerRoot);
    const bound = resolver();
    const packageBuilder = vi.spyOn({ buildPredictivePackageV1 }, "buildPredictivePackageV1");
    const forecastBuilder = vi.spyOn({ issueForecastV1 }, "issueForecastV1");
    const bootstrapBuilder = vi.spyOn(
      { buildPredictiveTerminalReceiptAsyncV1 },
      "buildPredictiveTerminalReceiptAsyncV1",
    );
    const packageHits: number[] = [];
    const forecastHits: number[] = [];
    const bootstrapHits: number[] = [];
    withStrictScientificResolverV1(bound, () => {
      const pkg = resolveScientificPackageV1(packageInput);
      expect(pkg.family.codeReleaseSha).toBe(originId.releaseSha);
      expect(
        resolveScientificEvidenceV1(
          "wf-forecast-batch-v1",
          { surface: "BTCUSDT:30", offset: 0 },
          "origin",
        ),
      ).toEqual({ origin: true });
      expect(
        resolveScientificEvidenceV1(
          "wf-forecast-batch-v1",
          { surface: "ETHUSDT:30", offset: 0 },
          "producer",
        ),
      ).toEqual({ producer: true });
      expect(
        resolveScientificEvidenceV1(
          PREDICTIVE_TERMINAL_CHECKPOINT_STAGE,
          { surface: "BTCUSDT:30" },
          "evaluator",
        ),
      ).toEqual({ terminal: true });
      packageHits.push(1);
      forecastHits.push(1);
      bootstrapHits.push(1);
    });
    expect(packageBuilder).not.toHaveBeenCalled();
    expect(forecastBuilder).not.toHaveBeenCalled();
    expect(bootstrapBuilder).not.toHaveBeenCalled();
    expect(originBefore).toBe(snapshot(originRoot));
    expect(producerBefore).toBe(snapshot(producerRoot));
    expect(packageHits).toHaveLength(1);
    expect(forecastHits).toHaveLength(1);
    expect(bootstrapHits).toHaveLength(1);
  });

  it("keeps O/P/R identities distinct and refuses a collapsed graph", () => {
    seed();
    expect(scientificForecastEvidenceNamespaceV1("BTCUSDT:30")).toBe("origin");
    expect(scientificForecastEvidenceNamespaceV1("ETHUSDT:30")).toBe("producer");
    expect(isEvaluatorDurableBootstrapStageV1(PREDICTIVE_TERMINAL_CHECKPOINT_STAGE)).toBe(true);
    expect(isEvaluatorDurableBootstrapStageV1("wf-predictive-bootstrap-range-v1")).toBe(true);
    expect(() => resolver({ evaluator: originId })).toThrow("COLLAPSED_IDENTITY");
    expect(() => resolver({ producer: originId })).toThrow("COLLAPSED_IDENTITY");
    expect(STRICT_SCIENTIFIC_EVIDENCE_RESOLVER_CONTRACT_V1).toBe(
      "waia.strict-scientific-evidence-resolver.v1",
    );
  });

  it("refuses missing, corrupt, cross-origin, wrong producer, wrong evaluator and wrong runtime", () => {
    seed();
    const bound = resolver();
    withStrictScientificResolverV1(bound, () => {
      expect(() =>
        resolveScientificEvidenceV1("wf-forecast-batch-v1", { missing: true }, "origin"),
      ).toThrow("MISSING");
      expect(() =>
        resolveScientificEvidenceV1(
          PREDICTIVE_TERMINAL_CHECKPOINT_STAGE,
          { surface: "BTCUSDT:30" },
          "origin",
        ),
      ).toThrow("CROSS_ORIGIN");
      expect(() =>
        resolveScientificEvidenceV1(
          "wf-forecast-batch-v1",
          { surface: "BTCUSDT:30", offset: 0 },
          "producer",
        ),
      ).toThrow("MISSING");
    });
    const originKey = deriveScientificCheckpointKeyV1({
      releaseSha: originId.releaseSha,
      runtime: originId.runtime,
      stage: "wf-forecast-batch-v1",
      kind: "evidence",
      input: { surface: "BTCUSDT:30", offset: 0 },
    });
    chmodSync(originRoot, 0o700);
    writeFileSync(join(originRoot, originKey, "evidence.bin"), "tampered");
    chmodSync(originRoot, 0o500);
    const corrupted = resolver();
    withStrictScientificResolverV1(corrupted, () => {
      expect(() =>
        resolveScientificEvidenceV1(
          "wf-forecast-batch-v1",
          { surface: "BTCUSDT:30", offset: 0 },
          "origin",
        ),
      ).toThrow(/CORRUPT|PAYLOAD|CROSS_ORIGIN/);
    });
    const wrongProducer = { ...producerId, releaseSha: "c".repeat(40) };
    const wrongEvaluator = { ...evaluatorId, releaseSha: "d".repeat(40) };
    const wrongRuntime = {
      ...originId,
      runtime: { ...originId.runtime, node: "v22.23.0" },
    };
    expect(() => assertScientificEvidenceIdentityV1("producer", producerId, wrongProducer)).toThrow(
      "WRONG_PRODUCER",
    );
    expect(() =>
      assertScientificEvidenceIdentityV1("evaluator", evaluatorId, wrongEvaluator),
    ).toThrow("WRONG_EVALUATOR");
    expect(() => assertScientificEvidenceIdentityV1("origin", originId, wrongRuntime)).toThrow(
      "WRONG_RUNTIME",
    );
    expect(() =>
      resolver({ producer: wrongProducer }).resolveEvidence(
        "wf-forecast-batch-v1",
        { surface: "ETHUSDT:30", offset: 0 },
        "producer",
      ),
    ).toThrow("MISSING");
    expect(() =>
      resolver({ evaluator: wrongEvaluator }).resolveEvidence(
        PREDICTIVE_TERMINAL_CHECKPOINT_STAGE,
        { surface: "BTCUSDT:30" },
        "evaluator",
      ),
    ).toThrow("MISSING");
    expect(() =>
      resolver({ origin: wrongRuntime }).resolveEvidence(
        "wf-forecast-batch-v1",
        { surface: "BTCUSDT:30", offset: 0 },
        "origin",
      ),
    ).toThrow("MISSING");
    expect(() =>
      resolver({ producer: undefined }).resolveEvidence(
        "wf-forecast-batch-v1",
        { surface: "ETHUSDT:30", offset: 0 },
        "producer",
      ),
    ).toThrow("PRODUCER_ABSENT");
  });

  it("resolves evaluator terminal and future per-range bootstrap without builders", async () => {
    seed();
    const bootstrapBuilder = vi.fn();
    const bound = resolver();
    await withStrictScientificResolverV1(bound, async () => {
      expect(
        await resolveScientificEvidenceAsyncV1(
          PREDICTIVE_TERMINAL_CHECKPOINT_STAGE,
          { surface: "BTCUSDT:30" },
          "evaluator",
        ),
      ).toEqual({ terminal: true });
      expect(
        await resolveScientificEvidenceAsyncV1(
          "wf-predictive-bootstrap-range-v1",
          { range: [0, 31] },
          "evaluator",
        ),
      ).toEqual({ range: true });
    });
    expect(bootstrapBuilder).not.toHaveBeenCalled();
  });

  it("replays the same sealed scientific digest as preparation with zero builders", () => {
    seed();
    const bound = resolver();
    const digestOf = (value: unknown) =>
      createHash("sha256").update(serialize(value)).digest("hex");
    const readGraph = () =>
      withStrictScientificResolverV1(bound, () =>
        Object.freeze({
          pkg: resolveScientificPackageV1(packageInput).predictivePackageContentDigest.toString(
            "hex",
          ),
          originForecast: resolveScientificEvidenceV1(
            "wf-forecast-batch-v1",
            { surface: "BTCUSDT:30", offset: 0 },
            "origin",
          ),
          producerForecast: resolveScientificEvidenceV1(
            "wf-forecast-batch-v1",
            { surface: "ETHUSDT:30", offset: 0 },
            "producer",
          ),
          terminal: resolveScientificEvidenceV1(
            PREDICTIVE_TERMINAL_CHECKPOINT_STAGE,
            { surface: "BTCUSDT:30" },
            "evaluator",
          ),
          range: resolveScientificEvidenceV1(
            "wf-predictive-bootstrap-range-v1",
            { range: [0, 31] },
            "evaluator",
          ),
        }),
      );
    const preparation = readGraph();
    const replay = readGraph();
    expect(digestOf(replay)).toBe(digestOf(preparation));
    expect(resolveScientificEvidenceV1).toBeTypeOf("function");
  });
});
