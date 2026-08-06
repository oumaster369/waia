/**
 * WP-3B host qualification probe (ADR-0025 AD-6).
 *
 * Answers one question about a candidate CI runner: can it prove strict native copy-on-write
 * clone and complete the canonical 1-GiB checkpoint inside the 400 ms blocking budget, using the
 * exact production clone mechanism and the exact production checkpoint sequence?
 *
 * A runner qualifies only when every measured iteration passes. Averages, projections, warm-up
 * values, partial intervals and non-reflink fallbacks never qualify a host.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, platform, tmpdir } from "node:os";
import { join } from "node:path";

import {
  FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
  FHV_CHECKPOINT_TARGET_MS_PER_10K,
  measureFhvCheckpointSnapshotCost,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";
import { probeFhvNativeCloneCapability } from "@/lib/trader/observability/fhv-native-clone";

const MEASURED_ITERATIONS = 3;

function shell(command: string): string {
  try {
    return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unavailable";
  }
}

function describeFilesystem(path: string): string {
  if (platform() === "darwin") return shell(`df -h ${path} | tail -n 1`);
  return shell(`df -hT ${path} | tail -n 1`);
}

function buildQualificationFixture(sessionPath: string): number {
  // A 1-GiB-equivalent checkpoint source. Incompressible content so no filesystem can cheat the
  // copy or the digest.
  const chunk = randomBytes(8 * 1024 * 1024);
  const handle = writeFileSync;
  handle(sessionPath, Buffer.alloc(0));
  const { appendFileSync } = require("node:fs") as typeof import("node:fs");
  let written = 0;
  while (written < FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES) {
    appendFileSync(sessionPath, chunk);
    written += chunk.byteLength;
  }
  return statSync(sessionPath).size;
}

function main(): void {
  const root = join(tmpdir(), `fhv-wp3b-hostqual-${process.pid}`);
  mkdirSync(root, { recursive: true });
  const sessionPath = join(root, "session.sqlite");

  const cpuModel = cpus()[0]?.model ?? "unknown";
  console.log(`[wp3b-hostqual] runner_label=${process.env.WP3B_RUNNER_LABEL ?? "unknown"}`);
  console.log(
    `[wp3b-hostqual] image=${process.env.ImageOS ?? "unknown"}/${process.env.ImageVersion ?? "unknown"}`,
  );
  console.log(
    `[wp3b-hostqual] platform=${platform()} arch=${arch()} cpu_model=${cpuModel} cpu_count=${cpus().length}`,
  );
  console.log(`[wp3b-hostqual] node=${process.version}`);
  console.log(`[wp3b-hostqual] fs_before=${describeFilesystem(root)}`);

  const capability = probeFhvNativeCloneCapability({
    directory: root,
    writeProbe: (path) => writeFileSync(path, randomBytes(4096)),
  });
  console.log(
    `[wp3b-hostqual] clone_status=${capability.status} reflink_used=${capability.supported} mechanism=${capability.mechanism} detail=${capability.detail}`,
  );

  const fixtureBytes = buildQualificationFixture(sessionPath);
  console.log(`[wp3b-hostqual] fixture_bytes=${fixtureBytes}`);

  // One uncounted warm-up, then the measured canonical iterations. Checkpoint material is cleaned
  // between iterations so no run reuses a published checkpoint as its own output.
  const warmDir = join(root, "warmup");
  measureFhvCheckpointSnapshotCost({ sessionPath, workDir: warmDir });
  rmSync(warmDir, { recursive: true, force: true });
  console.log(`[wp3b-hostqual] warmup=complete (uncounted)`);

  const measured: number[] = [];
  let allClonesProven = true;
  for (let iteration = 1; iteration <= MEASURED_ITERATIONS; iteration += 1) {
    const workDir = join(root, `iteration-${iteration}`);
    const sample = measureFhvCheckpointSnapshotCost({ sessionPath, workDir });
    rmSync(workDir, { recursive: true, force: true });
    measured.push(sample.totalDurationMs);
    if (!sample.ficloneSucceeded) allClonesProven = false;
    console.log(
      `[wp3b-hostqual] iteration=${iteration} bytes=${sample.sessionBytes} total_ms=${sample.totalDurationMs} snapshot_ms=${sample.snapshotDurationMs} digest_ms=${sample.digestDurationMs} publish_fsync_rename_ms=${sample.publishDurationMs} reflink_used=${sample.ficloneSucceeded}`,
    );
  }

  console.log(`[wp3b-hostqual] fs_after=${describeFilesystem(root)}`);
  rmSync(root, { recursive: true, force: true });

  const worst = Math.max(...measured);
  const best = Math.min(...measured);
  // Every measured iteration must pass; an average is not a qualification.
  const everyIterationWithinBudget = measured.every(
    (value) => value <= FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  );
  const qualified = capability.supported && allClonesProven && everyIterationWithinBudget;

  console.log(
    `[wp3b-hostqual] measured_ms=[${measured.join(", ")}] worst_ms=${worst} best_ms=${best} spread_ms=${Number((worst - best).toFixed(3))}`,
  );
  console.log(
    `[wp3b-hostqual] budget_ms=${FHV_CHECKPOINT_BUDGET_MS_PER_10K} target_ms=${FHV_CHECKPOINT_TARGET_MS_PER_10K} every_iteration_within_budget=${everyIterationWithinBudget}`,
  );
  console.log(
    `[wp3b-hostqual] RESULT=${qualified ? "RUNNER_QUALIFIED" : "RUNNER_NOT_QUALIFIED"} clone_proven=${capability.supported && allClonesProven}`,
  );

  if (!qualified) {
    process.exitCode = 1;
  }
}

main();
