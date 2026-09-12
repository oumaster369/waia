/** Standalone synthetic-only parity driver. No corpus/checkpoint/application API. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";
import {
  INTERNAL_validationBootstrapOrdinalRangeV1,
  validationBootstrapResampleV1,
} from "../../lib/trader/research/benchmark/validation-bootstrap-v1";
import { independentValidationResample } from "../../tests/unit/helpers/validation-bootstrap-independent-reference";

const binary = process.argv[2];
assert(binary && process.argv.length === 3, "Supply one already compiled native experiment path");
const executable = resolve(binary);
const sharedSampler = spawnSync(executable, ["--self-test-rng"], { timeout: 60_000, maxBuffer: 64 * 1024 });
assert.equal(sharedSampler.status, 0, sharedSampler.stderr?.toString());
assert.deepEqual(JSON.parse(sharedSampler.stdout.toString()), {
  kind: "synthetic-shared-sampler-self-test", count: 1000000, rejections: 80,
  outputDigest: "b2f4534b38591bf7ad0cad059dc75b443b571558bde158764806790ab8ffd412",
});
const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const bits = (value: number) => { const b = Buffer.alloc(8); b.writeDoubleBE(value); return b.toString("hex"); };
const trial = (seed: string) => createHash("sha256").update(`DEE998-synthetic:${seed}`).digest();
function frame(source: number[], digest: Buffer, start: number, end: number) {
  const b = Buffer.alloc(52 + source.length * 8);
  b.write("WAIAVB01"); b.writeUInt32LE(source.length, 8); b.writeUInt32LE(start, 12); b.writeUInt32LE(end, 16);
  digest.copy(b, 20); source.forEach((value, i) => b.writeDoubleLE(value, 52 + i * 8)); return b;
}
function run(input: Buffer) {
  const start = performance.now();
  const result = spawnSync(executable, [], { input, timeout: 60_000, maxBuffer: 64 * 1024 });
  return { ...result, elapsedMs: performance.now() - start };
}
const measurements: Array<Record<string, unknown>> = [];
function check(name: string, source: number[], seed: string, start: number, end: number) {
  const digest = trial(seed), input = frame(source, digest, start, end);
  const referenceStarted = performance.now();
  const reference = INTERNAL_validationBootstrapOrdinalRangeV1({
    differentials: source, trialIdentityDigest32: digest,
  }, start, end);
  const referenceMs = performance.now() - referenceStarted;
  const root = createHash("sha256").update("WAIAVALBOOTROOT1").update(digest).digest();
  const centered = source.map(value => value - reference.dBar);
  const statisticHash = createHash("sha256");
  // Small cases use an independent transcription; the large synthetic case also
  // checks the ordered statistic bits, but uses the production index generator.
  for (let b = start; b < end; b++) {
    const sample = source.length <= 128
      ? independentValidationResample(centered, root, b).resampled
      : validationBootstrapResampleV1({ source: centered, validationBootstrapRoot: root,
        resampleOrdinal: b }).resampled;
    const statistic = Math.sqrt(source.length) * (sample.reduce((sum, value) => sum + value, 0) / source.length);
    statisticHash.update(Buffer.from(bits(statistic), "hex"));
  }
  const actual = run(input);
  assert.equal(actual.error, undefined, name);
  assert.equal(actual.status, 0, `${name}: ${actual.stderr.toString()}`);
  const value = JSON.parse(actual.stdout.toString());
  assert.deepEqual(value, {
    version: "native-bootstrap-range-experiment/v1", n: source.length, start, endExclusive: end,
    extremeCount: reference.extremeCount, dBarBits: bits(reference.dBar), tObsBits: bits(reference.tObs),
    centeredMeanBits: bits(reference.centeredMean), statisticDigest: statisticHash.digest("hex"),
    rootHex: root.toString("hex"), admission: "NOT_ESTABLISHED",
  }, name);
  measurements.push({ name, n: source.length, start, end, inputSha256: sha(input),
    outputSha256: sha(actual.stdout), referenceMs, nativeMs: actual.elapsedMs, exactParity: true });
}

for (const n of [1, 2, 8, 9, 27, 28, 64, 65, 127]) {
  for (const seed of ["alpha", "beta"]) {
    check(`cube-boundary-${n}-${seed}`, Array.from({ length: n }, (_, i) => (i % 7 - 3) / 16 + (i % 2 ? 1e-12 : -1e-12)), seed, 0, 23);
  }
}
check("positive", [1, 2, 3, 4], "positive", 9997, 10000);
check("negative", [-1, -2, -3, -4], "negative", 9997, 10000);
check("signed-zero", [-0, 0, -0], "zero", 0, 10000);
check("complete-mixed", [-0.5, 0.25, 0.125, -0.25, 0.25, 0.1, -0.1, 0.125], "mixed", 0, 10000);
check("cancellation", [1e15, 0.125, -1e15, 1e-200, -1e-200, -0.5], "cancellation", 3, 40);
check("subnormal", [Number.MIN_VALUE, -Number.MIN_VALUE, 0, 1e-310], "subnormal", 0, 31);
check("large-N-bounded", Array.from({ length: 525547 }, (_, i) => (i % 101 - 50) / 1024), "large", 9998, 10000);

const valid = frame([1, -1], trial("bad"), 0, 2);
const arithmeticFailures = [
  [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE],
  [-1e308, 1e308],
];
for (const differentials of arithmeticFailures) {
  assert.throws(() => INTERNAL_validationBootstrapOrdinalRangeV1({
    differentials, trialIdentityDigest32: trial("bad"),
  }, 0, 100));
}
const malformed: Buffer[] = [Buffer.alloc(0), valid.subarray(0, 20), valid.subarray(0, valid.length - 1),
  Buffer.concat([valid, Buffer.from([0])]), frame([], trial("bad"), 0, 1),
  frame([NaN], trial("bad"), 0, 1), frame([Infinity], trial("bad"), 0, 1),
  frame([-Infinity], trial("bad"), 0, 1), frame([Number.MAX_VALUE, Number.MAX_VALUE], trial("bad"), 0, 1),
  frame([0], trial("bad"), 1, 1), frame([0], trial("bad"), 2, 1), frame([0], trial("bad"), 0, 10001),
  ...arithmeticFailures.map(source => frame(source, trial("bad"), 0, 100)),
];
const badMagic = Buffer.from(valid); badMagic[0] ^= 1; malformed.push(badMagic);
const oversized = Buffer.from(valid); oversized.writeUInt32LE(1000001, 8); malformed.push(oversized);
for (const input of malformed) {
  const result = run(input); assert.equal(result.status, 1); assert.equal(result.stdout.length, 0);
  assert.equal(result.stderr.toString(), "NATIVE_BOOTSTRAP_RANGE_REFUSED\n");
}
console.log(JSON.stringify({ kind: "synthetic-native-bootstrap-parity-not-qualification", runtime: process.version,
  platform: process.platform, arch: process.arch, executableSha256: sha(readFileSync(executable)),
  parityCases: measurements.length, negativeCases: malformed.length, sharedSamplerRejections: 80, measurements,
  scope: "No corpus, forecasts, stored checkpoint reads/writes, application integration or admission" }, null, 2));
