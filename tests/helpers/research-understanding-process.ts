/** Child proof: selected real CLI; no setup/source/old evaluator module in this process. */
import { createRequire } from "node:module";
import { assertRecordedAnalysisTestDatabase } from "./recorded-paper-public-transport";
const payload = JSON.parse(process.env.WAIA_RESEARCH_TEST_PAYLOAD!);
assertRecordedAnalysisTestDatabase(process.env.DATABASE_URL_POSTGRES);
let fetches = 0;
globalThis.fetch = (async () => { fetches++; throw new Error("RESEARCH_PROCESS_TRANSPORT_FORBIDDEN"); }) as typeof fetch;
async function main() {
  const { runPaperBarCloseCli } = await import("../../scripts/trader/paper-bar-close-loop");
  const result = await runPaperBarCloseCli(payload.args);
  const loaded = Object.keys(createRequire(import.meta.url).cache);
  const forbidden = loaded.filter(path => /market-data-gateway|htx-bar-poll-source|evaluate-recorded-analysis|evaluation-cycle|paper-bar-close-loop-legacy|mock-exchange-connector|\/execution\/|\/forecast\//.test(path));
  console.info(JSON.stringify({ event: "result", result, fetches, forbidden }));
  if (result?.status !== "COMPLETE") process.exitCode = 1;
  if (payload.holdAfterResult) await new Promise(() => { setInterval(() => {}, 1000); });
}
main().catch(error => { console.info(JSON.stringify({ event: "error", name: error?.name, code: error?.code, message: error?.message, fetches })); process.exitCode = 1; });
