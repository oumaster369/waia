/**
 * Sweep stale FHV temporary dataset roots (WP-0).
 *
 * Deletion requires ALL of: inactive owner, older than the minimum age, a verified identity
 * sidecar, and a newer retained root carrying the same `datasetContentDigest`. Roots without a
 * verifiable identity are always retained for Human review.
 *
 * Usage:
 *   node --import tsx scripts/ops/fhv-sweep-stale-temp-datasets.ts --dry-run
 *   node --import tsx scripts/ops/fhv-sweep-stale-temp-datasets.ts --confirm [--min-age-ms N]
 */
import {
  FHV_STALE_TEMP_MIN_AGE_MS,
  measureFhvAvailableBytes,
  sweepStaleFhvTempRoots,
} from "@/tests/helpers/fhv-temp-root-registry";
import { tmpdir } from "node:os";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  minAgeMs: number;
  tempRootDir: string | undefined;
} {
  let dryRun = true;
  let minAgeMs = FHV_STALE_TEMP_MIN_AGE_MS;
  let tempRootDir: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--confirm") {
      dryRun = false;
    } else if (arg === "--min-age-ms") {
      minAgeMs = Number(argv[++i]);
    } else if (arg === "--temp-root") {
      tempRootDir = argv[++i];
    }
  }
  if (!Number.isFinite(minAgeMs) || minAgeMs < 0) {
    throw new Error("BLOCKED_BY_FHV_TEMP_SWEEP_ARGS: --min-age-ms must be a non-negative number");
  }
  return { dryRun, minAgeMs, tempRootDir };
}

function main(): void {
  const { dryRun, minAgeMs, tempRootDir } = parseArgs(process.argv.slice(2));
  const root = tempRootDir ?? tmpdir();
  const result = sweepStaleFhvTempRoots({
    ...(tempRootDir ? { tempRootDir } : {}),
    minAgeMs,
    dryRun,
  });

  console.log(
    JSON.stringify(
      {
        schemaVersion: "fhv-temp-sweep-report/v1",
        tempRoot: root,
        dryRun: result.dryRun,
        minAgeMs,
        availableBytes: measureFhvAvailableBytes(root),
        scanned: result.plan.entries.length,
        deletable: result.plan.deletable.length,
        removed: result.removed.length,
        entries: result.plan.entries,
      },
      null,
      2,
    ),
  );

  if (result.dryRun && result.plan.deletable.length > 0) {
    console.log(
      `[fhv-temp-sweep] DRY RUN — ${result.plan.deletable.length} duplicate root(s) would be removed. Re-run with --confirm.`,
    );
  }
}

main();
