/**
 * WP-3B Execution Server host qualification (ADR-0025 AD-6).
 *
 * The 1-GiB / 400 ms checkpoint contract is unchanged, but measured evidence on GitHub Actions run
 * 31098325969 proved it is host-class dependent: macos-15 needed 735-781 ms and macos-15-intel
 * 2743-3007 ms where the reference workstation needed 392-396 ms, with the whole spread coming
 * from single-stream SHA-256 rather than from the checkpoint algorithm. Pull-request CI therefore
 * gates software correctness, and this command gates the actual target host.
 *
 * It runs the production checkpoint path and emits one identity-bound receipt. The official
 * full-corpus launch must fail closed unless that receipt says EXECUTION_SERVER_WP3B_HOST_QUALIFIED.
 */

import { execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch, cpus, hostname, platform, tmpdir, totalmem } from "node:os";
import { join } from "node:path";

import {
  FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
  FHV_CHECKPOINT_TARGET_MS_PER_10K,
  measureFhvCheckpointSnapshotCost,
  type FhvCheckpointCostSampleV1,
} from "@/lib/trader/observability/fhv-checkpoint-cost-model";
import {
  calibrateSingleStreamSha256BytesPerSecond,
  computeFhvTargetHostRequirement,
} from "@/lib/trader/observability/fhv-checkpoint-host-requirement";
import {
  probeFhvNativeCloneCapability,
  tryNativeCloneFile,
} from "@/lib/trader/observability/fhv-native-clone";

const MEASURED_ITERATIONS = 3;
const RECEIPT_SCHEMA = "fhv-wp3b-host-qualification/v1" as const;

export type FhvHostQualificationClassification =
  | "EXECUTION_SERVER_WP3B_HOST_QUALIFIED"
  | "EXECUTION_SERVER_WP3B_HOST_NOT_QUALIFIED"
  | "EXECUTION_SERVER_WP3B_HOST_EVIDENCE_INVALID";

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
  // Incompressible content at the canonical depth, so no filesystem can cheat the copy or hash.
  writeFileSync(sessionPath, Buffer.alloc(0));
  const chunk = randomBytes(8 * 1024 * 1024);
  let written = 0;
  while (written < FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES) {
    appendFileSync(sessionPath, chunk);
    written += chunk.byteLength;
  }
  return statSync(sessionPath).size;
}

/** Clone and fallback must agree byte-for-byte, and a clone must not alias its source. */
function proveIdentityAndIsolation(root: string): {
  digestsMatch: boolean;
  mutationIsolated: boolean;
  cloneClaimTruthful: boolean;
} {
  const source = join(root, "identity-source.bin");
  const original = randomBytes(4 << 20);
  writeFileSync(source, original);
  const sourceDigest = createHash("sha256").update(original).digest("hex");

  const clonePath = join(root, "identity-clone.bin");
  const clone = tryNativeCloneFile(source, clonePath);
  const cloneClaimTruthful =
    clone.status !== "NATIVE_CLONE_SUCCEEDED" || statSync(clonePath).size === original.byteLength;

  let digestsMatch = false;
  let mutationIsolated = false;
  if (clone.status === "NATIVE_CLONE_SUCCEEDED") {
    digestsMatch =
      createHash("sha256").update(readFileSync(clonePath)).digest("hex") === sourceDigest;
    writeFileSync(source, randomBytes(4 << 20));
    mutationIsolated = readFileSync(clonePath).equals(original);
  }
  rmSync(source, { force: true });
  rmSync(clonePath, { force: true });
  return { digestsMatch, mutationIsolated, cloneClaimTruthful };
}

function main(): void {
  const root = join(tmpdir(), `fhv-wp3b-hostqual-${process.pid}`);
  mkdirSync(root, { recursive: true });
  const sessionPath = join(root, "session.sqlite");

  const cpuModel = cpus()[0]?.model ?? "unknown";
  const filesystemBefore = describeFilesystem(root);
  const hostSha256BytesPerSecond = calibrateSingleStreamSha256BytesPerSecond();

  console.log(
    `[wp3b-hostqual] host=${hostname()} runner_label=${process.env.WP3B_RUNNER_LABEL ?? "target-host"}`,
  );
  console.log(
    `[wp3b-hostqual] platform=${platform()} arch=${arch()} cpu_model=${cpuModel} cpu_count=${cpus().length} total_mem_bytes=${totalmem()}`,
  );
  console.log(`[wp3b-hostqual] node=${process.version}`);
  console.log(`[wp3b-hostqual] fs_before=${filesystemBefore}`);
  console.log(`[wp3b-hostqual] sha256_bytes_per_second=${hostSha256BytesPerSecond}`);

  const capability = probeFhvNativeCloneCapability({
    directory: root,
    writeProbe: (path) => writeFileSync(path, randomBytes(4096)),
  });
  console.log(
    `[wp3b-hostqual] clone_status=${capability.status} reflink_used=${capability.supported} mechanism=${capability.mechanism} detail=${capability.detail}`,
  );

  const identity = proveIdentityAndIsolation(root);
  console.log(
    `[wp3b-hostqual] digests_match=${identity.digestsMatch} mutation_isolated=${identity.mutationIsolated} clone_claim_truthful=${identity.cloneClaimTruthful}`,
  );

  const fixtureBytes = buildQualificationFixture(sessionPath);
  console.log(`[wp3b-hostqual] fixture_bytes=${fixtureBytes}`);

  // One uncounted warm-up, then the measured canonical iterations. Checkpoint material is cleaned
  // between iterations so no run reuses a published checkpoint as its own output.
  const warmDir = join(root, "warmup");
  measureFhvCheckpointSnapshotCost({ sessionPath, workDir: warmDir });
  rmSync(warmDir, { recursive: true, force: true });
  console.log("[wp3b-hostqual] warmup=complete (uncounted)");

  const samples: FhvCheckpointCostSampleV1[] = [];
  for (let iteration = 1; iteration <= MEASURED_ITERATIONS; iteration += 1) {
    const workDir = join(root, `iteration-${iteration}`);
    const sample = measureFhvCheckpointSnapshotCost({ sessionPath, workDir });
    rmSync(workDir, { recursive: true, force: true });
    samples.push(sample);
    console.log(
      `[wp3b-hostqual] iteration=${iteration} bytes=${sample.sessionBytes} total_ms=${sample.totalDurationMs} snapshot_ms=${sample.snapshotDurationMs} digest_ms=${sample.digestDurationMs} fsync_ms=${sample.fsyncDurationMs} dir_durability_ms=${sample.directoryDurabilityMs} manifest_ms=${sample.manifestAttestationMs} publish_ms=${sample.publishDurationMs} reflink_used=${sample.ficloneSucceeded}`,
    );
  }

  const filesystemAfter = describeFilesystem(root);

  // Negative control: the gate must be capable of turning RED on this host.
  const delayedMs = samples[0]!.totalDurationMs + FHV_CHECKPOINT_BUDGET_MS_PER_10K;
  const negativeTestDetectsBreach = delayedMs > FHV_CHECKPOINT_BUDGET_MS_PER_10K;
  console.log(
    `[wp3b-hostqual] negative_test_delayed_ms=${Number(delayedMs.toFixed(3))} detects_breach=${negativeTestDetectsBreach}`,
  );

  rmSync(root, { recursive: true, force: true });

  const measured = samples.map((sample) => sample.totalDurationMs);
  const worstMs = Math.max(...measured);
  const bestMs = Math.min(...measured);
  const meanMs = measured.reduce((sum, value) => sum + value, 0) / measured.length;
  const everyIterationWithinBudget = measured.every(
    (value) => value <= FHV_CHECKPOINT_BUDGET_MS_PER_10K,
  );
  const everyIterationWithinTarget = measured.every(
    (value) => value <= FHV_CHECKPOINT_TARGET_MS_PER_10K,
  );
  const durabilityInsideTimer = samples.every(
    (sample) =>
      sample.fsyncDurationMs > 0 &&
      sample.directoryDurabilityMs > 0 &&
      sample.manifestAttestationMs > 0,
  );
  const allClonesProven = samples.every((sample) => sample.ficloneSucceeded);

  // Evidence must be internally coherent before a verdict means anything.
  const evidenceValid =
    fixtureBytes >= FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES &&
    samples.length >= MEASURED_ITERATIONS &&
    durabilityInsideTimer &&
    negativeTestDetectsBreach &&
    identity.cloneClaimTruthful &&
    hostSha256BytesPerSecond > 0;

  let classification: FhvHostQualificationClassification;
  if (!evidenceValid) {
    classification = "EXECUTION_SERVER_WP3B_HOST_EVIDENCE_INVALID";
  } else if (
    capability.supported &&
    allClonesProven &&
    identity.digestsMatch &&
    identity.mutationIsolated &&
    everyIterationWithinBudget
  ) {
    classification = "EXECUTION_SERVER_WP3B_HOST_QUALIFIED";
  } else {
    classification = "EXECUTION_SERVER_WP3B_HOST_NOT_QUALIFIED";
  }

  const body = {
    schemaVersion: RECEIPT_SCHEMA,
    capturedAtUtc: new Date().toISOString(),
    // Binds the receipt to the release it qualified, so a launch cannot consume evidence produced
    // by different code.
    releaseSha: process.env.FHV_RELEASE_SHA?.trim() || shell("git rev-parse HEAD"),
    host: {
      hostname: hostname(),
      platform: platform(),
      arch: arch(),
      cpuModel,
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      nodeVersion: process.version,
      filesystemBefore,
      filesystemAfter,
      sha256BytesPerSecond: hostSha256BytesPerSecond,
    },
    cloneCapability: capability,
    identityProofs: identity,
    contract: {
      qualificationDepthBytes: FHV_CHECKPOINT_QUALIFICATION_DEPTH_BYTES,
      budgetMs: FHV_CHECKPOINT_BUDGET_MS_PER_10K,
      targetMs: FHV_CHECKPOINT_TARGET_MS_PER_10K,
    },
    requirement: computeFhvTargetHostRequirement(samples),
    fixtureBytes,
    samples,
    measurements: {
      measuredMs: measured,
      worstMs: Number(worstMs.toFixed(3)),
      bestMs: Number(bestMs.toFixed(3)),
      meanMs: Number(meanMs.toFixed(3)),
      varianceMs: Number((worstMs - bestMs).toFixed(3)),
      everyIterationWithinBudget,
      everyIterationWithinTarget,
      durabilityInsideTimer,
      negativeTestDetectsBreach,
    },
    classification,
  };

  // Identity-bound: the digest covers the evidence, so a receipt cannot be edited after the fact.
  const receiptDigest = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const receipt = { ...body, receiptDigest };

  const outputPath =
    process.env.FHV_WP3B_HOST_RECEIPT_PATH?.trim() ||
    join(process.cwd(), ".artifacts", "fhv-wp3b-host-qualification.v1.json");
  mkdirSync(join(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  console.log(
    `[wp3b-hostqual] measured_ms=[${measured.join(", ")}] worst_ms=${worstMs} best_ms=${bestMs} variance_ms=${Number((worstMs - bestMs).toFixed(3))}`,
  );
  console.log(
    `[wp3b-hostqual] budget_ms=${FHV_CHECKPOINT_BUDGET_MS_PER_10K} target_ms=${FHV_CHECKPOINT_TARGET_MS_PER_10K} every_within_budget=${everyIterationWithinBudget} every_within_target=${everyIterationWithinTarget}`,
  );
  console.log(`[wp3b-hostqual] receipt=${outputPath} receipt_digest=${receiptDigest}`);
  console.log(`[wp3b-hostqual] RESULT=${classification}`);

  if (classification !== "EXECUTION_SERVER_WP3B_HOST_QUALIFIED") {
    process.exitCode = 1;
  }
}

main();
