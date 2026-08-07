/**
 * Phase 0 read-only bounded HTX source capability probes.
 * Does not acquire bulk data; emits probe evidence for Human review.
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { HtxRestClient } from "@/lib/trader/connectors/htx/client";
import { HTX_DEFAULT_REST_HOST, HTX_ENDPOINTS } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  buildFhvHtxSourceCapabilityArtifact,
  FHV_HTX_SOURCE_CAPABILITY_ARTIFACT_RELATIVE_PATH,
} from "@/lib/trader/market-data/fhv-htx-source-capability";

const FROM_2020 = Math.floor(Date.parse("2020-01-01T00:00:00.000Z") / 1000);
const TO_2026 = Math.floor(Date.parse("2026-01-01T00:00:00.000Z") / 1000);
const FROM_2025_LATE = Math.floor(Date.parse("2025-12-31T12:00:00.000Z") / 1000);

function probeDigest(rows: readonly HtxKlineRow[]): string {
  return createHash("sha256").update(JSON.stringify(rows), "utf8").digest("hex");
}

function combinedProbeDigest(probes: Record<string, readonly HtxKlineRow[]>): string {
  return createHash("sha256")
    .update(JSON.stringify(probes, Object.keys(probes).sort()), "utf8")
    .digest("hex");
}

function isoFromId(id: number): string {
  return new Date(id * 1000).toISOString();
}

async function main(): Promise<void> {
  const client = new HtxRestClient({
    restHost: HTX_DEFAULT_REST_HOST,
    apiKey: "public-market-probe",
    apiSecret: "public-market-probe",
  });
  const symbols = ["btcusdt", "ethusdt"] as const;
  const oldestRows: Record<string, HtxKlineRow[]> = {};
  const newestRows: Record<string, HtxKlineRow[]> = {};
  const probes: Record<string, unknown> = {};

  for (const symbol of symbols) {
    const oldest = await client.getMarketHistoryCandles({
      symbol,
      period: "1min",
      size: 10,
      from: FROM_2020,
    });
    const newest = await client.getMarketHistoryCandles({
      symbol,
      period: "1min",
      size: 10,
      from: FROM_2025_LATE,
      to: TO_2026,
    });
    oldestRows[symbol] = oldest;
    newestRows[symbol] = newest;
    const oldestIds = oldest.map((row) => row.id);
    const newestIds = newest.map((row) => row.id);
    probes[symbol] = {
      oldest: {
        count: oldest.length,
        minOpenUtc: oldestIds.length > 0 ? isoFromId(Math.min(...oldestIds)) : null,
        maxOpenUtc: oldestIds.length > 0 ? isoFromId(Math.max(...oldestIds)) : null,
        digest: probeDigest(oldest),
      },
      newest: {
        count: newest.length,
        minOpenUtc: newestIds.length > 0 ? isoFromId(Math.min(...newestIds)) : null,
        maxOpenUtc: newestIds.length > 0 ? isoFromId(Math.max(...newestIds)) : null,
        digest: probeDigest(newest),
      },
    };
  }

  const earliestMs = symbols.flatMap((symbol) => {
    const entry = probes[symbol] as { oldest: { minOpenUtc: string | null } };
    return entry.oldest.minOpenUtc ? [Date.parse(entry.oldest.minOpenUtc)] : [];
  });
  const latestMs = symbols.flatMap((symbol) => {
    const entry = probes[symbol] as { newest: { maxOpenUtc: string | null } };
    return entry.newest.maxOpenUtc ? [Date.parse(entry.newest.maxOpenUtc)] : [];
  });

  const earliestProven =
    earliestMs.length > 0 ? new Date(Math.min(...earliestMs)).toISOString() : null;
  const latestProven = latestMs.length > 0 ? new Date(Math.max(...latestMs)).toISOString() : null;

  const boundedOldestRangeProbeDigest = combinedProbeDigest(oldestRows);
  const boundedNewestRangeProbeDigest = combinedProbeDigest(newestRows);

  const rangeProven =
    earliestProven !== null &&
    latestProven !== null &&
    earliestProven <= "2020-01-01T00:00:00.000Z" &&
    latestProven >= "2025-12-31T23:59:00.000Z" &&
    symbols.every((symbol) => {
      const entry = probes[symbol] as {
        oldest: { count: number };
        newest: { count: number };
      };
      return entry.oldest.count > 0 && entry.newest.count > 0;
    });

  const report = {
    classification: rangeProven
      ? "HTX_OFFICIAL_2020_2025_SOURCE_CAPABILITY_PROVEN"
      : "HTX_OFFICIAL_2020_2025_SOURCE_CAPABILITY_PROBE_INSUFFICIENT",
    endpoint: `${HTX_DEFAULT_REST_HOST}${HTX_ENDPOINTS.marketHistoryCandles}`,
    requiredRangeHalfOpen: "[2020-01-01T00:00:00.000Z, 2026-01-01T00:00:00.000Z)",
    earliestProvenTimestamp: earliestProven,
    latestProvenTimestamp: latestProven,
    boundedOldestRangeProbeDigest,
    boundedNewestRangeProbeDigest,
    rangeProven,
    probes,
    retrievedAtUtc: new Date().toISOString(),
  };

  if (rangeProven && earliestProven && latestProven) {
    const artifact = buildFhvHtxSourceCapabilityArtifact({
      retrievedAtUtc: report.retrievedAtUtc,
      boundedOldestRangeProbeDigest,
      boundedNewestRangeProbeDigest,
      earliestProvenTimestamp: earliestProven,
      latestProvenTimestamp: latestProven,
    });
    const artifactPath = join(process.cwd(), FHV_HTX_SOURCE_CAPABILITY_ARTIFACT_RELATIVE_PATH);
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(JSON.stringify({ ...report, artifactPath, artifactWritten: true }, null, 2));
    return;
  }

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
