/**
 * Operator CLI: generate preregistered revision-risk evidence from acquired bytes + refetch.
 *
 * Usage:
 *   pnpm trader:fhv:revision-risk -- --release-sha <40hex> --organization-id <uuid> \
 *     --operator-id <id> --dataset-root <path> --real-htx --out <path>
 *
 * Never accesses blind holdout. Network refetch requires explicit --real-htx.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import { assertPathDoesNotAccessBlindHoldoutPayload } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import {
  compareFhvRevisionRiskSample,
  digestOperationalRevisionRiskFromAcquiredFile,
  FHV_PREREGISTERED_REVISION_RISK_SAMPLES,
  type FhvRevisionRiskSampleEvidenceV1,
} from "@/lib/trader/market-data/fhv-revision-risk-evidence";
import { computeStableJsonDigest } from "@/lib/trader/research/digest";
import { HtxRestClient } from "@/lib/trader/connectors/htx/client";

const FULL_SHA = /^[0-9a-f]{40}$/;

function parseArgv(argv: readonly string[]): Map<string, string | true> {
  const parsed = new Map<string, string | true>();
  const tokens = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    if (token === "--real-htx") {
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

export function resolveFhvRevisionRiskCliConfig(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv.slice(2),
) {
  const flags = parseArgv(argv);
  return {
    releaseSha: (flags.get("--release-sha") as string | undefined) ?? env.FHV_RELEASE_SHA?.trim(),
    organizationId:
      (flags.get("--organization-id") as string | undefined) ?? env.FHV_ORGANIZATION_ID?.trim(),
    operatorId: (flags.get("--operator-id") as string | undefined) ?? env.FHV_OPERATOR_ID?.trim(),
    datasetRoot:
      (flags.get("--dataset-root") as string | undefined) ?? env.FHV_DATASET_ROOT?.trim(),
    out: flags.get("--out") as string | undefined,
    realHtx: flags.has("--real-htx"),
  };
}

async function main(): Promise<void> {
  const config = resolveFhvRevisionRiskCliConfig();
  if (!config.releaseSha || !FULL_SHA.test(config.releaseSha.trim().toLowerCase())) {
    throw new Error("--release-sha <40 hex chars> is required");
  }
  if (!config.organizationId || !config.operatorId || !config.datasetRoot || !config.out) {
    throw new Error("--organization-id, --operator-id, --dataset-root, and --out are required");
  }
  if (!config.realHtx) {
    throw new Error("pass --real-htx; network refetch is never implicit");
  }
  assertPathDoesNotAccessBlindHoldoutPayload(config.datasetRoot);
  assertPathDoesNotAccessBlindHoldoutPayload(config.out);
  const client = new HtxRestClient({
    apiKey: process.env.HTX_ACCESS_KEY?.trim() || "public",
    apiSecret: process.env.HTX_SECRET_KEY?.trim() || "public",
  });
  const acquiredAtUtc = new Date().toISOString();
  const evidence: FhvRevisionRiskSampleEvidenceV1[] = [];
  for (const sample of FHV_PREREGISTERED_REVISION_RISK_SAMPLES) {
    const operationalDigest = digestOperationalRevisionRiskFromAcquiredFile({
      datasetRoot: config.datasetRoot,
      sample,
    });
    evidence.push(
      await compareFhvRevisionRiskSample({
        sample,
        operationalDigest,
        operationalAcquiredAtUtc: acquiredAtUtc,
        refetchAcquiredAtUtc: new Date().toISOString(),
        fetchPage: (page) =>
          client.getMarketHistoryCandles({
            symbol: page.symbol,
            period: page.period,
            size: page.size,
            from: page.from,
            to: page.to,
          }),
      }),
    );
  }
  const body = {
    schemaVersion: "fhv-revision-risk-evidence-set/v1" as const,
    releaseSha: config.releaseSha.trim().toLowerCase(),
    organizationId: config.organizationId,
    operatorId: config.operatorId,
    datasetRoot: config.datasetRoot,
    samples: evidence,
  };
  const payload = { ...body, evidenceSetDigest: computeStableJsonDigest(body) };
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(payload, null, 2)}\n`);
  const changed = evidence.some((row) => row.comparison === "CHANGED");
  const classification = changed ? "REVISION_RISK=HUMAN_DECISION_REQUIRED" : "REVISION_RISK=SAME";
  process.stdout.write(
    `artifact=${config.out}\ndigest=${payload.evidenceSetDigest}\nclassification=${classification}\n`,
  );
  if (changed) {
    process.exitCode = 0;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
