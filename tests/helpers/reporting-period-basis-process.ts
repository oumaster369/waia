import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema.postgres";
import { readReportingPeriodBasisV1Postgres } from "../../lib/trader/billing/v2/reporting-period-basis-postgres-v1";

async function main() {
  const url = process.env.WAIA_BASIS_TEST_URL!;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("LOOPBACK_REQUIRED");
  const { context, input } = JSON.parse(process.env.WAIA_BASIS_TEST_INPUT!);
  const client = postgres(url, { max: 1 });
  try { process.stdout.write(JSON.stringify(await readReportingPeriodBasisV1Postgres(drizzle(client, { schema }), context, input)) + "\n"); }
  finally { await client.end({ timeout: 5 }); }
}
main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
