/** Synthetic throughput only; fixed input/ordinals, no scientific-data interface. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { resolve } from "node:path";

assert(process.argv.length === 3, "Supply the already parity-tested experiment binary");
const executable = resolve(process.argv[2]!);
const n = 525547, ordinalsPerRange = 8, ranges = 4;
const source = Buffer.alloc(n * 8);
for (let i = 0; i < n; i++) source.writeDoubleLE((i % 101 - 50) / 1024, i * 8);
const trial = createHash("sha256").update("DEE998-synthetic:large").digest();
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function input(range: number) {
  const header = Buffer.alloc(52); header.write("WAIAVB01"); header.writeUInt32LE(n, 8);
  header.writeUInt32LE(range * ordinalsPerRange, 12);
  header.writeUInt32LE((range + 1) * ordinalsPerRange, 16); trial.copy(header, 20);
  return Buffer.concat([header, source]);
}
async function execute(range: number): Promise<Buffer> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(executable, [], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = []; let bytes = 0;
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("SYNTHETIC_TIMEOUT")); }, 60_000);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.stdin.on("error", reject);
    child.stdout.on("data", (b: Buffer) => { bytes += b.length; if (bytes > 65536) child.kill("SIGKILL"); else out.push(b); });
    child.stderr.on("data", (b: Buffer) => { bytes += b.length; if (bytes > 65536) child.kill("SIGKILL"); else err.push(b); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0 || bytes > 65536 || err.length) reject(new Error("SYNTHETIC_CHILD_REFUSED"));
      else resolveResult(Buffer.concat(out));
    });
    child.stdin.end(input(range));
  });
}
async function main() {
  const observations = [];
  for (let repeat = 0; repeat < 2; repeat++) {
    const start = performance.now(), serial: Buffer[] = [];
    for (let range = 0; range < ranges; range++) serial.push(await execute(range));
    const serialMs = performance.now() - start;
    const parallelStart = performance.now();
    const parallel = await Promise.all(Array.from({ length: ranges }, (_, i) => execute(i)));
    const parallelMs = performance.now() - parallelStart;
    assert.deepEqual(parallel, serial, "Changing worker count must not change range result bytes");
    observations.push({ repeat, serialMs, parallelMs, speedup: serialMs / parallelMs,
      rangeOutputDigests: parallel.map(digest) });
  }
  console.log(JSON.stringify({ kind: "bounded-synthetic-native-concurrency-not-qualification",
    n, ranges, ordinalsPerRange, totalOrdinals: ranges * ordinalsPerRange,
    sampledPositionsPerRound: n * ranges * ordinalsPerRange,
    executableSha256: digest(readFileSync(executable)), inputDigests: Array.from({ length: ranges }, (_, i) => digest(input(i))),
    runtime: process.version, platform: process.platform, arch: process.arch, observations,
    limitations: "Synthetic input; excludes Forecast, full B, baseline preparation, checkpoints, Holm and release acceptance" }, null, 2));
}
main().catch(() => { console.error("SYNTHETIC_CONCURRENCY_REFUSED"); process.exitCode = 1; });
