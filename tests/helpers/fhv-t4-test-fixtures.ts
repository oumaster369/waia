import type { FhvT4ObserverSystemdIdentityV1 } from "@/lib/trader/observability/fhv-t4-observer-systemd-identity";
import {
  FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION,
  FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION,
  writeFhvT4CampaignRuntimeProof,
  type FhvT4CampaignRuntimeStartV1,
  type FhvT4CampaignRuntimeV1,
} from "@/lib/trader/observability/fhv-t4-closure-verifiers";
import { FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS } from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";
import { writeFileAtomic } from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";
import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  setFhvT4HostMonotonicReaderForTests,
  type FhvT4HostMonotonicSampleV1,
} from "@/lib/trader/observability/fhv-t4-host-monotonic-clock";

export const FHV_T4_TEST_BOOT_ID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
export const FHV_T4_TEST_OBSERVER_BOOT_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
export const FHV_T4_TEST_STARTED_NS = "1_000_000_000".replace(/_/g, "");
export const FHV_T4_TEST_COMPLETED_NS = "290_000_000_000".replace(/_/g, "");
export const FHV_T4_TEST_SERVICE_USER_IDS = { uid: 1001, gid: 1001 };

export function installFhvT4HostMonotonicTestReader(
  samples: readonly FhvT4HostMonotonicSampleV1[],
): () => void {
  let index = 0;
  setFhvT4HostMonotonicReaderForTests(() => {
    const sample = samples[Math.min(index, samples.length - 1)]!;
    index += 1;
    return sample;
  });
  process.env.FHV_T4_SERVICE_USER_IDS_JSON = JSON.stringify(FHV_T4_TEST_SERVICE_USER_IDS);
  return () => {
    setFhvT4HostMonotonicReaderForTests(null);
    delete process.env.FHV_T4_SERVICE_USER_IDS_JSON;
  };
}

export function fhvT4HostMonotonicSample(
  monotonicNs: string,
  bootId = FHV_T4_TEST_BOOT_ID,
): FhvT4HostMonotonicSampleV1 {
  return {
    schemaVersion: "fhv-t4-host-monotonic-sample/v1",
    clockSource: "CLOCK_BOOTTIME",
    bootId,
    monotonicNs,
  };
}

export function fhvT4ObserverIdentity(input: {
  invocationId: string;
  mainPid: number;
  activeEnterTimestampMonotonicUs?: string;
  bootId?: string;
}): FhvT4ObserverSystemdIdentityV1 {
  return {
    schemaVersion: "fhv-t4-observer-systemd-identity/v1",
    unitName: "waia-fhv-observer.service",
    bootId: input.bootId ?? FHV_T4_TEST_OBSERVER_BOOT_ID,
    invocationId: input.invocationId,
    mainPid: input.mainPid,
    activeEnterTimestampMonotonicUs:
      input.activeEnterTimestampMonotonicUs ?? String(input.mainPid * 1_000_000),
    activeState: "active",
  };
}

export function writeFhvT4TestCampaignRuntimeStart(
  runDir: string,
  input: {
    runId: string;
    organizationId: string;
    targetSha: string;
    hostBootId?: string;
    startedMonotonicNs?: string;
    startedAtUtc?: string;
  },
): FhvT4CampaignRuntimeStartV1 {
  const withoutDigest = {
    schemaVersion: FHV_T4_CAMPAIGN_RUNTIME_START_SCHEMA_VERSION,
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
    fixtureId: "HTR_WP03_BENCHMARK" as const,
    hostBootId: input.hostBootId ?? FHV_T4_TEST_BOOT_ID,
    startedMonotonicNs: input.startedMonotonicNs ?? FHV_T4_TEST_STARTED_NS,
    startedAtUtc: input.startedAtUtc ?? new Date().toISOString(),
  };
  const record = {
    ...withoutDigest,
    contentDigest: computePayloadDigest(withoutDigest),
  };
  writeFileAtomic(
    join(runDir, "fhv-t4-campaign-runtime-start.v1.json"),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  return record;
}

export function writeFhvT4TestCampaignRuntimeProof(
  runDir: string,
  input: {
    runId: string;
    organizationId: string;
    targetSha: string;
    hostBootId?: string;
    startedMonotonicNs?: string;
    completedMonotonicNs?: string;
    elapsedMonotonicNs?: string;
  },
): FhvT4CampaignRuntimeV1 {
  const startedMonotonicNs = input.startedMonotonicNs ?? FHV_T4_TEST_STARTED_NS;
  const completedMonotonicNs = input.completedMonotonicNs ?? FHV_T4_TEST_COMPLETED_NS;
  const elapsedMonotonicNs =
    input.elapsedMonotonicNs ??
    (BigInt(completedMonotonicNs) - BigInt(startedMonotonicNs)).toString();
  return writeFhvT4CampaignRuntimeProof(runDir, {
    runId: input.runId,
    organizationId: input.organizationId,
    targetSha: input.targetSha,
    fixtureId: "HTR_WP03_BENCHMARK",
    hostBootId: input.hostBootId ?? FHV_T4_TEST_BOOT_ID,
    startedMonotonicNs,
    completedMonotonicNs,
    elapsedMonotonicNs,
    maxBudgetMs: FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS,
    startedAtUtc: new Date().toISOString(),
    completedAtUtc: new Date().toISOString(),
  });
}

export function writeFhvT4TestCampaignRuntimeV1Legacy(
  runDir: string,
  input: {
    runId: string;
    organizationId: string;
    targetSha: string;
  },
): void {
  writeFileAtomic(
    join(runDir, "fhv-t4-campaign-runtime.v1.json"),
    `${JSON.stringify(
      {
        schemaVersion: FHV_T4_CAMPAIGN_RUNTIME_SCHEMA_VERSION,
        runId: input.runId,
        organizationId: input.organizationId,
        targetSha: input.targetSha,
        fixtureId: "HTR_WP03_BENCHMARK",
        hostBootId: FHV_T4_TEST_BOOT_ID,
        startedMonotonicNs: FHV_T4_TEST_STARTED_NS,
        completedMonotonicNs: FHV_T4_TEST_COMPLETED_NS,
        elapsedMonotonicNs: (
          BigInt(FHV_T4_TEST_COMPLETED_NS) - BigInt(FHV_T4_TEST_STARTED_NS)
        ).toString(),
        maxBudgetMs: FHV_T4_CAMPAIGN_RUNTIME_MAX_BUDGET_MS,
        startedAtUtc: new Date().toISOString(),
        completedAtUtc: new Date().toISOString(),
        contentDigest: "placeholder",
      },
      null,
      2,
    )}\n`,
  );
  const path = join(runDir, "fhv-t4-campaign-runtime.v1.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown> & {
    contentDigest: string;
  };
  const { contentDigest: _ignored, ...withoutDigest } = raw;
  raw.contentDigest = computePayloadDigest(withoutDigest);
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`);
}
