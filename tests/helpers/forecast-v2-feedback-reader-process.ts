/** Real new-process reader. Loopback test DB only; no fixture or authority mutation. */
import postgres from "postgres";
import { readForecastV2FeedbackPostgres, type ForecastV2FeedbackReference } from
  "../../lib/trader/intelligence/outcome-resolution/forecast-v2-feedback-read-port-postgres";

async function main() {
const url = process.env.DATABASE_URL_POSTGRES;
if (process.env.WAIA_PG_INTEGRATION !== "1" || !url ||
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
  throw new Error("DEE1110_PROCESS_REQUIRES_LOOPBACK_POSTGRES");
}
let input = "";
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.length > 8192) throw new Error("DEE1110_PROCESS_INPUT_TOO_LARGE");
}
const parsed = JSON.parse(input) as { organizationId: string; reference: ForecastV2FeedbackReference };
const sql = postgres(url, { max: 1 });
try {
  process.stdout.write(JSON.stringify(await readForecastV2FeedbackPostgres(sql,
    { organizationId: parsed.organizationId }, parsed.reference)));
} finally { await sql.end({ timeout: 5 }); }

}
main().catch((error: unknown) => {
  process.stderr.write(error instanceof Error ? error.message : "Child reader failed");
  process.exitCode = 1;
});
