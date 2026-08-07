/**
 * DEE-436 — FHV v2 dataset read-only validation CLI.
 *
 * Usage:
 *   pnpm trader:fhv:validate-v2-dataset -- --dataset-root <path>
 */

import { validateFhvV2DatasetReadOnly } from "@/lib/trader/market-data/fhv-dataset-seal";

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

async function main(): Promise<void> {
  const flags = parseArgv(process.argv.slice(2));
  const datasetRoot = flags.get("--dataset-root") ?? process.env.FHV_DATASET_ROOT?.trim();
  if (!datasetRoot) {
    throw new Error("--dataset-root is required");
  }

  const result = validateFhvV2DatasetReadOnly(datasetRoot);
  console.log(
    JSON.stringify(
      {
        classification: result.classification,
        manifestSemanticDigest: result.manifest.manifestSemanticDigest,
        datasetContentDigest: result.manifest.datasetContentDigest,
        partitionCount: result.manifest.partitions.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
