/**
 * DEE-526 — HTX volume qualification CLI.
 *
 * Usage:
 *   pnpm trader:htx:volume-qualify -- --fixture tests/fixtures/trader/htx-kline-btcusdt-1m.json
 */

import { readFileSync } from "node:fs";

import type { HtxKlineRow } from "@/lib/trader/connectors/htx/types";
import {
  assertHtxVolumeAuthorityQualified,
  qualifyHtxKlineVolumeAuthority,
  type HtxVolumeQualificationReceiptV1,
} from "@/lib/trader/market-data/volume-qualification/htx-volume-qualification";

function parseArgv(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const value = tokens[index + 1]?.trim();
    if (!value) {
      throw new Error(`Missing value for ${token}`);
    }
    parsed.set(token, value);
    index += 1;
  }
  return parsed;
}

export function runHtxVolumeQualification(input: {
  fixturePath: string;
  symbol?: string;
}): HtxVolumeQualificationReceiptV1 {
  const raw = JSON.parse(readFileSync(input.fixturePath, "utf8")) as {
    kline?: { data?: HtxKlineRow[] };
    data?: HtxKlineRow[];
  };
  const rows = raw.kline?.data ?? raw.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Fixture must contain HTX kline rows.");
  }
  const receipt = qualifyHtxKlineVolumeAuthority({
    symbol: input.symbol ?? "BTCUSDT",
    rows,
  });
  assertHtxVolumeAuthorityQualified(receipt);
  return receipt;
}

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));
  const fixturePath = flags.get("--fixture");
  if (!fixturePath) {
    throw new Error("--fixture is required.");
  }
  const receipt = qualifyHtxKlineVolumeAuthority({
    symbol: flags.get("--symbol") ?? "BTCUSDT",
    rows:
      (JSON.parse(readFileSync(fixturePath, "utf8")) as { kline?: { data?: HtxKlineRow[] } }).kline
        ?.data ?? [],
  });
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${receipt.verdict}\n`);
  process.exitCode = receipt.verdict === "HTX_VOLUME_AUTHORITY_QUALIFIED" ? 0 : 1;
}

const invokedDirectly = process.argv[1]?.includes("htx-volume-qualification-cli.ts") ?? false;

if (invokedDirectly) {
  main().catch((error: unknown) => {
    process.stderr.write(`[htx-volume-qualify] FAILED: ${String(error)}\n`);
    process.exitCode = 1;
  });
}
