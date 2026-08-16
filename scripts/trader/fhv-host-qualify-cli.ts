/**
 * Aggregate DEE-536 HOST_QUALIFIED receipt from existing WP3B + throughput + T4 evidence.
 *
 * Usage:
 *   pnpm trader:fhv:host-qualify -- --release-sha <40hex> \
 *     --wp3b-receipt <path> --throughput-receipt <path> --t4-preflight <path> --out <path>
 *
 * Does not run host measurements. Does not invent budgets.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { aggregateFhvHostQualification } from "@/lib/trader/observability/fhv-host-qualification-receipt";

const FULL_SHA = /^[0-9a-f]{40}$/;

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

export function resolveFhvHostQualifyCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  return {
    releaseSha: (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim(),
    wp3bReceipt: flags.get("--wp3b-receipt"),
    throughputReceipt: flags.get("--throughput-receipt"),
    t4Preflight: flags.get("--t4-preflight"),
    out: flags.get("--out"),
  };
}

async function main(): Promise<void> {
  const config = resolveFhvHostQualifyCliConfig();
  if (!config.releaseSha || !FULL_SHA.test(config.releaseSha.trim().toLowerCase())) {
    throw new Error("--release-sha <40 hex chars> is required");
  }
  if (!config.wp3bReceipt || !config.throughputReceipt || !config.t4Preflight || !config.out) {
    throw new Error("--wp3b-receipt, --throughput-receipt, --t4-preflight, and --out are required");
  }
  const receipt = aggregateFhvHostQualification({
    releaseSha: config.releaseSha,
    wp3bReceiptPath: config.wp3bReceipt,
    throughputReceiptPath: config.throughputReceipt,
    t4PreflightPath: config.t4Preflight,
  });
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${receipt.classification}\n`);
  if (receipt.classification !== "HOST_QUALIFIED") {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
