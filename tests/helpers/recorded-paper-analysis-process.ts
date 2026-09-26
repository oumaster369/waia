/** Native fixture: actual CLI, inert HTTP, and observed-clock ordering after the actual gateway. */
import postgres from "postgres";
import { createRequire } from "node:module";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { recordedPublicTransport, assertRecordedAnalysisTestDatabase } from "./recorded-paper-public-transport";
import { captureSession } from "@/lib/trader/paper/durable-noncapital/recorded-analysis-v1";
import { completeRecordedAnalysisPostgresV1 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";
import { HtxBarPollSource } from "@/lib/trader/market-data/htx-bar-poll-source";
import { readRuntimeDatabaseClockV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { awaitRecordedBundleDatabaseClock } from "./recorded-paper-clock-barrier";
const payload = JSON.parse(process.env.WAIA_RECORDED_TEST_PAYLOAD!);
const url = process.env.DATABASE_URL_POSTGRES!;
assertRecordedAnalysisTestDatabase(url);
const emit = (value: unknown) => console.info(JSON.stringify(value));
let fetches = 0;
globalThis.fetch = recordedPublicTransport(() => payload.fixedSourceTime ?? Date.now(), () => { fetches++; if (payload.forbidFetch) throw new Error("REPLAY_TRANSPORT_FORBIDDEN"); });
async function main() {
  if (payload.operation === "complete") {
    const client = postgres(url, { max: 1, connection: { application_name: payload.applicationName ?? "dee1121-child" } });
    try {
      await client`SET default_transaction_isolation = 'repeatable read'`;
      const result = await completeRecordedAnalysisPostgresV1(client, captureSession(payload.input), payload.holder, payload.input.startSequence);
      emit({ event: "result", outcome: result.outcome, digest: result.companion.contentDigest, fetches });
    } finally { await client.end({ timeout: 2 }); }
  } else if (payload.operation === "cli") {
    const input = payload.input;
    const flags = ["--durable-noncapital", ...Object.entries({ "org-id": input.organizationId, "account-key": input.accountId,
      symbol: input.symbol, "session-id": input.sessionId, "release-sha": input.releaseSha, "start-sequence": input.startSequence,
      "max-cycles": input.maxCycles, "max-packet-bytes": input.maxPacketBytes, "max-bars-per-interval": input.maxBarsPerInterval,
      "lease-duration-ms": input.leaseDurationMs }).map(([k, v]) => `--${k}=${v}`)];
    const fixtureClient = postgres(url, { max: 1, connection: { application_name: "dee1121-fixture-clock", statement_timeout: 2000 } });
    const fixtureDb = drizzle(fixtureClient, { schema });
    const original = HtxBarPollSource.prototype.fetchMandatoryEvaluationBundle;
    const clockBarriers: Awaited<ReturnType<typeof awaitRecordedBundleDatabaseClock>>[] = [];
    HtxBarPollSource.prototype.fetchMandatoryEvaluationBundle = async function () {
      const bundle = await original.call(this);
      clockBarriers.push(await awaitRecordedBundleDatabaseClock(bundle,
        () => fixtureDb.transaction(tx => readRuntimeDatabaseClockV2(tx), { accessMode: "read only" })));
      return bundle;
    };
    const { result, loaded } = await (async () => {
      try {
        const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
        return { result: await runPaperBarCloseCli(flags), loaded: Object.keys(createRequire(import.meta.url).cache) };
      } finally {
        HtxBarPollSource.prototype.fetchMandatoryEvaluationBundle = original;
        await fixtureClient.end({ timeout: 2 });
      }
    })();
    emit({ event: "result", result, fetches, clockBarriers, legacyLoaded: loaded.some(path => path.includes("paper-bar-close-loop-legacy")),
      mockLoaded: loaded.some(path => path.includes("mock-exchange-connector")) });
  } else if (payload.operation === "claim") {
    const client = postgres(url, { max: 1, connection: { application_name: payload.applicationName } });
    try {
      const { claimRuntimeControlLeaseAtDatabaseTimeV2 } = await import("@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2");
      emit({ event: "result", claim: await claimRuntimeControlLeaseAtDatabaseTimeV2(drizzle(client, { schema }), payload.claim) });
    } finally { await client.end({ timeout: 2 }); }
  }
  if (payload.holdAfterResult) await new Promise(() => { setInterval(() => {}, 1000); });
}
main().catch(error => { emit({ event: "error", name: error?.name, code: error?.code, message: error?.message }); process.exitCode = 1; });
