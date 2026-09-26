/** Isolated native-PG crash/competition fixture; never a runtime entry point. */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema.postgres";
import { claimRuntimeControlLeaseAtDatabaseTimeV2 } from "@/lib/trader/runtime-authority/v2/runtime-control-lease-database-clock-postgres-v2";
import { commitRecordedNoncapitalCyclePostgresV2 } from "@/lib/trader/runtime-v2/noncapital-cycle-owner-postgres-v2";

async function main() {
  const url = process.env.WAIA_NONCAPITAL_TEST_URL!;
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(new URL(url).hostname)) throw new Error("LOOPBACK_REQUIRED");
  const payload = JSON.parse(process.env.WAIA_NONCAPITAL_TEST_PAYLOAD!);
  const client = postgres(url, { max: 1, connection: { application_name: payload.applicationName } });
  const db = drizzle(client, { schema });
  const emit = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const hold = () => new Promise<void>(() => { setInterval(() => undefined, 1000); });
  try {
    if (payload.operation === "claim") {
      emit({ event: "claim", claim: await claimRuntimeControlLeaseAtDatabaseTimeV2(db, payload.request) });
    } else if (payload.operation === "stage") {
      await db.transaction(async tx => {
        await commitRecordedNoncapitalCyclePostgresV2(tx, payload.context, payload.holder, payload.input);
        emit({ event: "staged" });
        await hold();
      });
    } else if (payload.operation === "commit-hold") {
      await commitRecordedNoncapitalCyclePostgresV2(db, payload.context, payload.holder, payload.input);
      emit({ event: "committed" });
      await hold();
    } else throw new Error("INVALID_TEST_OPERATION");
  } finally { await client.end({ timeout: 2 }); }
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "TEST_PROCESS_FAILED"}\n`); process.exitCode = 1; });
