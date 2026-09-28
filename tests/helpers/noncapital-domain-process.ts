/** Test-only child transport/observer. The selected production CLI owns its pool. */
import { createRequire } from "node:module";
import { assertRecordedAnalysisTestDatabase, recordedPublicTransport } from "./recorded-paper-public-transport";
assertRecordedAnalysisTestDatabase(process.env.DATABASE_URL_POSTGRES);
const input = JSON.parse(process.env.WAIA_DOMAIN_TEST_PAYLOAD!);
let fetches = 0;
globalThis.fetch = input.route === "acquisition"
  ? recordedPublicTransport(Date.now, () => { fetches++; }, { closedBarsOnly: true })
  : (async () => { fetches++; throw new Error("SAVED_DOMAIN_NETWORK_FORBIDDEN"); }) as typeof fetch;
async function main() {
  if (input.route !== "saved" && input.route !== "acquisition") throw new Error("DOMAIN_TEST_ROUTE_INVALID");
  const result = input.route === "acquisition"
    ? await (await import("../../scripts/trader/recorded-acquisition")).runRecordedAcquisitionCli(input.args)
    : await (await import("../../scripts/trader/saved-research")).runSavedResearchCli(input.args);
  const forbidden = Object.keys(createRequire(import.meta.url).cache).filter(file => /paper-bar-close-loop-legacy|evaluate-recorded-analysis|evaluation-cycle|mock-exchange|\/execution\/|\/forecast\/|hypothesis-service|measurement-service/.test(file)
    || (input.route === "saved" && /market-data-gateway|htx-bar-poll-source/.test(file)));
  console.info(JSON.stringify({ event: "result", result, fetches, forbidden }));
  if (result.status !== "COMPLETE") process.exitCode = 1;
  if (input.holdAfterResult) await new Promise(() => { setInterval(() => {}, 1000); });
}
main().catch(error => { console.info(JSON.stringify({ event: "error", code: error?.code, message: error?.message, fetches })); process.exitCode = 1; });
