/** Test-only child transport/observer. The selected production CLI owns its pool. */
import { createRequire } from "node:module";
import path from "node:path";
import { assertRecordedAnalysisTestDatabase, recordedPublicTransport } from "./recorded-paper-public-transport";
assertRecordedAnalysisTestDatabase(process.env.DATABASE_URL_POSTGRES);
const input = JSON.parse(process.env.WAIA_DOMAIN_TEST_PAYLOAD!);
let fetches = 0;
const transport: Array<{ method: string; host: string; path: string; authenticated: boolean }> = [];
const synthetic = recordedPublicTransport(Date.now, undefined, { closedBarsOnly: true });
globalThis.fetch = (async (request: RequestInfo | URL, init?: RequestInit) => {
  fetches++;
  if (input.route !== "acquisition") throw new Error("SAVED_DOMAIN_NETWORK_FORBIDDEN");
  const url = new URL(request instanceof Request ? request.url : String(request));
  const method = init?.method ?? (request instanceof Request ? request.method : "GET");
  const headers = new Headers(init?.headers ?? (request instanceof Request ? request.headers : undefined));
  const authenticated = [...headers.keys(), ...url.searchParams.keys()].some(key => /authorization|signature|access.?key|secret/i.test(key));
  if (method !== "GET" || url.protocol !== "https:" || url.hostname !== "api.huobi.pro" || authenticated ||
    !["/market/history/kline", "/market/detail/merged", "/market/depth", "/market/history/trade"].includes(url.pathname))
    throw new Error("DOMAIN_PUBLIC_GET_ONLY");
  transport.push({ method, host: url.hostname, path: url.pathname, authenticated });
  return synthetic(url, init);
}) as typeof fetch;
// These exact existing modules are required by the fixed observational acquisition
// owner. They remain forbidden for the independent saved-only route.
const acquisitionObservationalImports = [
  "lib/trader/paper/durable-noncapital/evaluate-recorded-analysis-v1.ts",
  "lib/trader/intelligence/evaluation-cycle.ts",
  "lib/trader/execution/v2/execution-admission-proof-v2.ts",
];
async function main() {
  if (input.route !== "saved" && input.route !== "acquisition") throw new Error("DOMAIN_TEST_ROUTE_INVALID");
  const result = input.route === "acquisition"
    ? await (await import("../../scripts/trader/recorded-acquisition")).runRecordedAcquisitionCli(input.args)
    : await (await import("../../scripts/trader/saved-research")).runSavedResearchCli(input.args);
  const loaded = Object.keys(createRequire(import.meta.url).cache).map(file => path.relative(process.cwd(), file));
  const forbidden = loaded.filter(file => ( /paper-bar-close-loop-legacy|evaluate-recorded-analysis|evaluation-cycle|mock-exchange|\/execution\/|\/forecast\/|hypothesis-service|measurement-service/.test(file)
    && !(input.route === "acquisition" && acquisitionObservationalImports.includes(file)))
    || (input.route === "saved" && /market-data-gateway|htx-bar-poll-source/.test(file)));
  const observationalImports = acquisitionObservationalImports.filter(file => loaded.includes(file));
  console.info(JSON.stringify({ event: "result", result, fetches, forbidden, observationalImports, transport }));
  if (result.status !== "COMPLETE") process.exitCode = 1;
  if (input.holdAfterResult) await new Promise(() => { setInterval(() => {}, 1000); });
}
main().catch(error => { console.info(JSON.stringify({ event: "error", code: error?.code, message: error?.message, fetches })); process.exitCode = 1; });
