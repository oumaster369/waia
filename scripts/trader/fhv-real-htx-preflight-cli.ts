/**
 * REAL_HTX_PREFLIGHT CLI.
 *
 * Usage:
 *   pnpm trader:fhv:real-htx-preflight -- --real-htx
 *   pnpm trader:fhv:real-htx-preflight -- --fixture
 *
 * Samples DEVELOPMENT / WF_PREDICTIVE / WF_ECONOMIC only. Never 2025.
 */

import { pathToFileURL } from "node:url";

import { HtxRestClient } from "@/lib/trader/connectors/htx/client";
import { HTX_DEFAULT_REST_HOST } from "@/lib/trader/connectors/htx/config";
import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import { runRealHtxPreflight } from "@/lib/trader/market-data/fhv-real-htx-preflight";

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (const token of tokens) {
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    parsed.set(token, true);
  }
  return parsed;
}

export function resolveFhvRealHtxPreflightCliConfig(
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  return {
    realHtx: flags.has("--real-htx"),
    fixture: flags.has("--fixture"),
  };
}

function fixtureRow(openSeconds: number, close: number): HtxKlineRow {
  return {
    id: openSeconds,
    open: close,
    close,
    low: close * 0.999,
    high: close * 1.001,
    amount: 3.946,
    vol: close * 3.946,
    count: 12,
  };
}

async function main(): Promise<void> {
  const config = resolveFhvRealHtxPreflightCliConfig();
  if (config.realHtx === config.fixture) {
    throw new Error("pass exactly one of --real-htx or --fixture");
  }
  const result = await runRealHtxPreflight({
    fetchPage: config.fixture
      ? async ({ from, size }) =>
          Array.from({ length: Math.min(size, 10) }, (_, index) =>
            fixtureRow(from + index * 60, 49_000),
          )
      : async (query) => {
          const client = new HtxRestClient({
            restHost: HTX_DEFAULT_REST_HOST,
            apiKey: process.env.HTX_ACCESS_KEY?.trim() || "public",
            apiSecret: process.env.HTX_SECRET_KEY?.trim() || "public",
          });
          return client.getMarketHistoryCandles(query);
        },
  });
  process.stdout.write(`${result.classification}\n`);
  if (result.classification !== "REAL_HTX_PREFLIGHT=PASS") {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
