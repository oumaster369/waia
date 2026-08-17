/**
 * Operator CLI: verify a pre-holdout qualification receipt against dataset bytes.
 *
 * Usage:
 *   pnpm trader:fhv:pre-holdout-verify -- --dataset-root <path> --receipt <path>
 *
 * Non-zero if classification is not PASS or files mutated.
 */

import { pathToFileURL } from "node:url";

import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  assertFhvPreHoldoutFilesMatchReceipt,
  assertFhvPreHoldoutQualificationPass,
  readFhvPreHoldoutQualificationReceipt,
} from "@/lib/trader/market-data/fhv-pre-holdout-qualification";

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
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

export function resolveFhvPreHoldoutVerifyCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  return {
    datasetRoot:
      (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim(),
    receipt: flags.get("--receipt") as string | undefined,
  };
}

async function main(): Promise<void> {
  const config = resolveFhvPreHoldoutVerifyCliConfig();
  if (!config.datasetRoot || !config.receipt) {
    throw new Error("--dataset-root and --receipt are required");
  }
  assertPathDoesNotAccessBlindHoldoutPayload(config.datasetRoot);
  assertPathDoesNotAccessBlindHoldoutPayload(config.receipt);
  const receipt = readFhvPreHoldoutQualificationReceipt(config.receipt);
  assertFhvPreHoldoutQualificationPass(receipt);
  assertFhvPreHoldoutFilesMatchReceipt({
    datasetRoot: config.datasetRoot,
    receipt,
  });
  process.stdout.write(
    `artifact=${config.receipt}\ndigest=${receipt.qualificationReceiptDigest}\nclassification=${receipt.classification}\n`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
