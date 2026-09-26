import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../../db/schema.postgres";
import { createPostgresBillingPeriodCloseOrchestrator } from "../../lib/trader/billing/billing-period-close-orchestrator";

async function main() {
  const url = process.env.WAIA_BILLING_REALITY_TEST_URL!;
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(new URL(url).hostname)) throw new Error("LOOPBACK_REQUIRED");
  const { context, input } = JSON.parse(process.env.WAIA_BILLING_REALITY_TEST_INPUT!);
  for (const key of ["periodStart", "periodEnd", "startingSnapshotAt", "endingSnapshotAt"]) input[key] = new Date(input[key]);
  const client = postgres(url, { max: 1 });
  try {
    const result = await createPostgresBillingPeriodCloseOrchestrator(drizzle(client, { schema })).closeAndMaterialize(context, input);
    process.stdout.write(JSON.stringify({ result }) + "\n");
  } finally { await client.end({ timeout: 5 }); }
}
main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });
