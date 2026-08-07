/**
 * DEE-436 — FHV v2 partition acquisition CLI.
 *
 * Usage (scale corpus for CI / deterministic proof):
 *   pnpm trader:fhv:acquire-htx-v2 -- --partition development --symbol BTCUSDT \
 *     --dataset-root /tmp/fhv-dataset --scale-corpus \
 *     --release-sha <sha> --organization-id <uuid> --operator-id <id> \
 *     --acquisition-run-id <id>
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  assertFhvPartitionBoundariesExact,
  fhvOfficialPartitionFileRelativePath,
  resolveFhvCanonicalPartitionInterval,
  type FhvOfficialPartitionName,
  type FhvOfficialSymbolCode,
} from "@/lib/trader/market-data/fhv-partition-boundaries";
import {
  computeFhvFileRawSha256,
  writeFhvAcquisitionReceipt,
} from "@/lib/trader/market-data/fhv-dataset-seal";
import { assertHtxOfficialSourceCapabilityProven } from "@/lib/trader/market-data/fhv-htx-source-capability";
import {
  generateFhvOfficialScalePartitionFile,
  resolveFhvOfficialScaleGlobalIndexOffset,
} from "@/lib/trader/market-data/fhv-official-scale-corpus";

const FULL_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTITIONS = new Set<FhvOfficialPartitionName>([
  "development",
  "walk-forward",
  "blind-holdout",
]);
const SYMBOLS = new Set<FhvOfficialSymbolCode>(["BTCUSDT", "ETHUSDT"]);

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    if (token === "--scale-corpus") {
      parsed.set(token, true);
      continue;
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

export function resolveFhvAcquireHtxV2CliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  const partition = flags.get("--partition") as FhvOfficialPartitionName | undefined;
  const symbol = flags.get("--symbol") as FhvOfficialSymbolCode | undefined;
  const datasetRoot =
    (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim();
  const releaseSha =
    (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim();
  const organizationId =
    (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim();
  const operatorId =
    (flags.get("--operator-id") as string | undefined) ?? env.FHV_OPERATOR_ID?.trim();
  const acquisitionRunId =
    (flags.get("--acquisition-run-id") as string | undefined) ?? env.FHV_ACQUISITION_RUN_ID?.trim();
  const scaleCorpus = flags.has("--scale-corpus");
  const startUtc = flags.get("--start-utc") as string | undefined;
  const endUtc = flags.get("--end-utc") as string | undefined;
  return {
    partition,
    symbol,
    datasetRoot,
    releaseSha,
    organizationId,
    operatorId,
    acquisitionRunId,
    scaleCorpus,
    startUtc,
    endUtc,
  };
}

async function main(): Promise<void> {
  const config = resolveFhvAcquireHtxV2CliConfig();
  if (!config.partition || !PARTITIONS.has(config.partition)) {
    throw new Error("--partition development|walk-forward|blind-holdout is required");
  }
  if (!config.symbol || !SYMBOLS.has(config.symbol)) {
    throw new Error("--symbol BTCUSDT|ETHUSDT is required");
  }
  if (!config.datasetRoot) {
    throw new Error("--dataset-root is required");
  }
  if (!config.releaseSha || !FULL_SHA.test(config.releaseSha)) {
    throw new Error("--release-sha must be a full git SHA");
  }
  if (!config.organizationId || !UUID_V4.test(config.organizationId)) {
    throw new Error("--organization-id must be UUID v4");
  }
  if (!config.operatorId?.trim()) {
    throw new Error("--operator-id is required");
  }
  if (!config.acquisitionRunId?.trim()) {
    throw new Error("--acquisition-run-id is required");
  }
  if (!config.scaleCorpus) {
    throw new Error(
      "Real HTX acquisition is not enabled in this build; pass --scale-corpus for deterministic official-scale corpus",
    );
  }

  const capability = assertHtxOfficialSourceCapabilityProven();
  const interval = resolveFhvCanonicalPartitionInterval(config.partition);
  if (config.startUtc || config.endUtc) {
    assertFhvPartitionBoundariesExact({
      partition: config.partition,
      startUtc: config.startUtc ?? interval.startUtc,
      endUtc: config.endUtc ?? interval.endUtc,
    });
  }

  mkdirSync(config.datasetRoot, { recursive: true });
  const relativePath = fhvOfficialPartitionFileRelativePath({
    partition: config.partition,
    symbol: config.symbol,
  });
  const globalIndexOffset = resolveFhvOfficialScaleGlobalIndexOffset({
    partition: config.partition,
    symbol: config.symbol,
  });
  const generated = generateFhvOfficialScalePartitionFile({
    datasetRoot: config.datasetRoot,
    partition: config.partition,
    symbol: config.symbol,
    globalIndexOffset,
  });
  const absolutePath = join(config.datasetRoot, relativePath);
  const rawSha256 = computeFhvFileRawSha256(absolutePath);
  const receiptDir = join(config.datasetRoot, "control", "acquisition");
  mkdirSync(receiptDir, { recursive: true });
  const { receiptPath } = writeFhvAcquisitionReceipt({
    receiptDir,
    acquisitionRunId: config.acquisitionRunId,
    releaseSha: config.releaseSha,
    organizationId: config.organizationId,
    operatorId: config.operatorId,
    sourceCapabilityReceiptDigest: capability.sourceCapabilityEvidenceDigest,
    partition: config.partition,
    symbol: config.symbol,
    startUtc: interval.startUtc,
    endUtc: interval.endUtc,
    outputRoot: config.datasetRoot,
    fileRelativePath: relativePath,
    rawSha256,
    actualBarCount: generated.barCount,
  });

  console.log(
    JSON.stringify(
      {
        classification: "FHV_V2_SCALE_FIXTURE_PARTITION_ACQUISITION_PASS",
        evidenceClass: "TEST_SCALE_FIXTURE" as const,
        partition: config.partition,
        symbol: config.symbol,
        barCount: generated.barCount,
        rawSha256,
        receiptPath,
        fileRelativePath: relativePath,
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
