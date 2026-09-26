import { createHash } from "node:crypto";
import type { GatewayPollResult } from "@/lib/trader/market-data/market-data-gateway";

/** Fixture ordering only: observe the real DB clock after the real gateway's last ingestion. */
export async function awaitRecordedBundleDatabaseClock(
  bundle: GatewayPollResult,
  readDatabaseClock: () => Promise<string>,
  timeoutMs = 2_000,
) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_000) throw new Error("FIXTURE_CLOCK_TIMEOUT_INVALID");
  const hash = () => createHash("sha256").update(JSON.stringify(bundle)).digest("hex");
  const bundleDigest = hash();
  const ingestTimes = bundle.canonicalPitCandidates.map(row => Date.parse(row.provenance.ingestTimeUtc));
  if (!ingestTimes.length || ingestTimes.some(value => !Number.isSafeInteger(value))) throw new Error("FIXTURE_INGEST_TIME_INVALID");
  const maxIngest = Math.max(...ingestTimes);
  const deadline = performance.now() + timeoutMs;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new Error("FIXTURE_DATABASE_CLOCK_TIMEOUT")); }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      let samples = 0;
      while (!expired && performance.now() < deadline) {
        const observedDatabaseTimeUtc = await readDatabaseClock(); samples++;
        if (expired) throw new Error("FIXTURE_DATABASE_CLOCK_TIMEOUT");
        const observed = Date.parse(observedDatabaseTimeUtc);
        if (!Number.isSafeInteger(observed)) throw new Error("FIXTURE_DATABASE_CLOCK_INVALID");
        if (hash() !== bundleDigest) throw new Error("FIXTURE_BUNDLE_MUTATED");
        if (observed >= maxIngest) return {
          bundleDigest, maxIngestTimeUtc: new Date(maxIngest).toISOString(), observedDatabaseTimeUtc, samples,
        };
      }
      throw new Error("FIXTURE_DATABASE_CLOCK_TIMEOUT");
    })()]);
  } finally { clearTimeout(timer); }
}
