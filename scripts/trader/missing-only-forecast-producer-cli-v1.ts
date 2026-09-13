import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindMissingOnlyProducerIdentityV1,
  createOriginReadOnlyPortV1,
  createProducerJournalV1,
  enumerateMissingWfForecastBatchesV1,
  issueControlForecastBatchV1,
  issueMissingForecastBatchV1,
  loadSelectedPreservedPackageV1,
  parseProducerMappingInputV1,
  type MissingOnlyProducerIdentityV1,
} from "./missing-only-forecast-producer-v1";
import type { SourceAnchor } from "../../lib/trader/intelligence/forecast-v2/source-anchor-v1";

function fail(reason: string): never {
  throw new Error(`MISSING_ONLY_FORECAST_PRODUCER_REFUSED:${reason}`);
}

function requiredSurfaceKey(
  value: string | undefined,
): "BTCUSDT:30" | "BTCUSDT:60" | "ETHUSDT:30" | "ETHUSDT:60" {
  if (
    value === "BTCUSDT:30" ||
    value === "BTCUSDT:60" ||
    value === "ETHUSDT:30" ||
    value === "ETHUSDT:60"
  )
    return value;
  fail("SURFACE");
}

function requiredAbsolute(value: string | undefined, reason: string): string {
  if (!value || !isAbsolute(value)) fail(reason);
  return value;
}

function parseOffset(value: string | undefined): number {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) fail("OFFSET");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) fail("OFFSET");
  return offset;
}

function requireRuntime(flags: Map<string, string>, identity: MissingOnlyProducerIdentityV1): void {
  const node = flags.get("--require-node") ?? fail("RUNTIME");
  const os = flags.get("--require-os") ?? fail("RUNTIME");
  const arch = flags.get("--require-arch") ?? fail("RUNTIME");
  if (
    node !== identity.runtime.node ||
    os !== identity.runtime.os ||
    arch !== identity.runtime.arch
  )
    fail("RUNTIME");
}

export function runMissingOnlyForecastProducerCliV1(args: string[]): number {
  try {
    const flags = new Map<string, string>();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i],
        value = args[i + 1];
      if (!key || !key.startsWith("--") || value === undefined || value.startsWith("--"))
        fail("USAGE");
      flags.set(key, value);
    }
    for (const forbidden of ["--package-builder", "--builder", "--build-package", "--fallback"]) {
      if (flags.has(forbidden)) fail("BUILDER_FALLBACK");
    }
    const mappingPath = flags.get("--mapping") ?? fail("MISSING_MAPPING");
    if (!isAbsolute(mappingPath)) fail("MAPPING_PATH");
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(mappingPath, "utf8"));
    } catch {
      fail("MISSING_MAPPING");
    }
    const envelope = parseProducerMappingInputV1(parsed);
    const mode = flags.get("--mode") ?? "enumerate";
    const producerSha = flags.get("--producer-sha") ?? fail("USAGE");
    const sourceRoot = flags.get("--source-root") ?? fail("USAGE");
    const originRoot = flags.get("--origin-root") ?? fail("USAGE");
    const identity = bindMissingOnlyProducerIdentityV1({ producerGitSha: producerSha, sourceRoot });
    const surfaceKey = requiredSurfaceKey(flags.get("--surface"));
    const anchorsPath = flags.get("--anchors-json") ?? fail("ANCHORS");
    if (!isAbsolute(anchorsPath)) fail("ANCHORS");
    const sourceCorpus = JSON.parse(readFileSync(anchorsPath, "utf8")) as SourceAnchor[];
    if (mode === "enumerate") {
      const producerRoot = flags.get("--producer-root") ?? fail("USAGE");
      const origin = createOriginReadOnlyPortV1(originRoot);
      const journal = createProducerJournalV1(producerRoot, identity);
      const missing = enumerateMissingWfForecastBatchesV1({
        envelope,
        surfaceKey,
        sourceCorpus,
        origin,
        journal,
      });
      process.stdout.write(
        `${JSON.stringify({
          format: "waia.trader.missing_only_forecast_producer.enumerate.v1",
          authorityGranted: false,
          identity,
          surfaceKey,
          missingCount: missing.length,
          missing: missing.map((batch) => ({
            offset: batch.offset,
            anchorCount: batch.anchorCount,
          })),
        })}\n`,
      );
      return 0;
    }
    if (mode === "control" || mode === "issue") {
      requireRuntime(flags, identity);
      if (identity.producerGitSha === envelope.mapping.O.releaseSha) fail("O_P_COLLAPSE");
      const packageRoot = requiredAbsolute(flags.get("--package-root"), "PACKAGE_ROOT");
      const offset = parseOffset(flags.get("--offset"));
      const origin = createOriginReadOnlyPortV1(originRoot);
      const pkg = loadSelectedPreservedPackageV1({ envelope, surfaceKey, packageRoot });
      if (mode === "control") {
        const result = issueControlForecastBatchV1({
          envelope,
          identity,
          surfaceKey,
          pkg,
          sourceCorpus,
          offset,
        });
        process.stdout.write(
          `${JSON.stringify({
            format: "waia.trader.missing_only_forecast_producer.control.v1",
            authorityGranted: false,
            surface: result.surfaceKey,
            offset: result.offset,
            rowCount: result.rowCount,
            rowsSha256: result.rowsSha256,
            identity: result.identity,
          })}\n`,
        );
        return 0;
      }
      const producerRoot = flags.get("--producer-root") ?? fail("USAGE");
      const producerEvidenceRoot = requiredAbsolute(
        flags.get("--producer-evidence-root"),
        "EVIDENCE_ROOT",
      );
      const journal = createProducerJournalV1(producerRoot, identity);
      const result = issueMissingForecastBatchV1({
        envelope,
        identity,
        origin,
        journal,
        producerEvidenceRoot,
        surfaceKey,
        pkg,
        sourceCorpus,
        offset,
        retryIncomplete: flags.get("--retry-incomplete") === "true",
      });
      process.stdout.write(
        `${JSON.stringify({
          format: "waia.trader.missing_only_forecast_producer.issue.v1",
          authorityGranted: false,
          surface: result.surfaceKey,
          offset: result.offset,
          rowCount: result.rowCount,
          producerKey: result.producerKey,
          payloadDigest: result.payloadDigest,
          rowsSha256: result.rowsSha256,
        })}\n`,
      );
      return 0;
    }
    return fail("USAGE");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    process.stderr.write(
      /^MISSING_ONLY_FORECAST_PRODUCER_REFUSED:[A-Z_]+$/.test(message) ||
        /^G1_TRUSTED_ORIGIN_MAPPING_REFUSED:[A-Z_]+$/.test(message) ||
        /^SCIENTIFIC_CHECKPOINT_REFUSED:[A-Z_]+$/.test(message)
        ? `${message}\n`
        : "MISSING_ONLY_FORECAST_PRODUCER_REFUSED\n",
    );
    return message.includes("MISSING_MAPPING") || message.includes("USAGE") ? 64 : 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runMissingOnlyForecastProducerCliV1(process.argv.slice(2));
}
