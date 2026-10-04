/**
 * DEE-383 / M8 — Operator-invoked discovery evolution orchestrator CLI stub.
 *
 * Usage:
 *   WAIA_DB_BACKEND=postgres DATABASE_URL_POSTGRES=... pnpm trader:discovery:run -- \
 *     --org-id=<uuid> \
 *     --campaign-id=<uuid> \
 *     [--enable=1]
 *
 * Default posture: disabled — pass --enable=1 with operator authorization.
 * Requires WAIA_TRADER_CLI=1 (set by package.json script).
 */

import { getPostgresDrizzle } from "@/db/postgres-client";
import {
  DEFAULT_DISCOVERY_RUN_CONFIG,
  DISCOVERY_SCHEMA_VERSION,
} from "@/lib/trader/discovery/discovery.types";
import { runDiscoveryEvolutionPass } from "@/lib/trader/discovery/evolution-orchestrator";
import type { DiscoveryEvolutionPassResult } from "@/lib/trader/discovery/evolution-orchestrator";
import { assertOperatorActionAllowed } from "@/lib/trader/operator/operator-authority";
import {
  buildCampaignRunFrontmatter,
  type CampaignRunFrontmatter,
} from "@/lib/trader/research/campaign-run-frontmatter";
import { prepareResearchDevelopmentSourcePostgresV1 } from "@/lib/trader/research/research-development-source-owner-postgres-v1";
import { prepareResearchDevelopmentEvaluationSourcePostgresV1 } from "@/lib/trader/research/research-development-evaluation-source-owner-postgres-v1";
import { captureResearchDevelopmentSourceRequestV1 } from "@/lib/trader/research/research-development-source-contract-v1";
import { captureResearchIssuedTrainingRequestV2 } from "@/lib/trader/research/research-issued-training-contract-v2";
import { runResearchIssuedTrainingDiagnosticPostgresV2, selectResearchIssuedTrainingFamilyPostgresV1 } from "@/lib/trader/research/research-issued-training-diagnostic-postgres-v2";
import { captureResearchTrainingFamilyRequestV1 } from "@/lib/trader/research/research-training-family-contract-v1";
import { registerResearchExperimentPostgresV1 } from "@/lib/trader/research/research-experiment-registry-postgres-v1";
import { registerResearchIssuedAttemptPostgresV2 } from "@/lib/trader/research/research-issued-attempt-postgres-v2";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import {
  readResearchExperimentProposalFile,
  runDiscoveryExperimentRegistrationBranch,
  runDiscoveryIssuedAttemptRegistrationBranch,
} from "@/scripts/trader/discovery-registration";
import { readResearchEvaluationSourceRequestFile, runDiscoveryEvaluationSourceBranch } from "@/scripts/trader/discovery-evaluation-source";

const LOG_PREFIX = "[trader:discovery:run]";

export type DiscoveryRunRecord = {
  /** Additive provenance block (DEE-407) — does not alter discovery pipeline semantics. */
  frontmatter: CampaignRunFrontmatter;
  result: DiscoveryEvolutionPassResult;
};

export function buildDiscoveryRunRecord(
  result: DiscoveryEvolutionPassResult,
  input?: { runId?: string },
): DiscoveryRunRecord {
  return {
    frontmatter: buildCampaignRunFrontmatter({
      runId: input?.runId,
    }),
    result,
  };
}

export function resolveDiscoveryRunExitCode(input: {
  enabled: boolean;
  barsCount: number;
  closedTradeCount: number;
  result: Pick<DiscoveryEvolutionPassResult, "reason" | "skipped" | "status">;
}): number {
  if (
    input.result.reason === "research_v2_admission_incomplete" ||
    input.result.reason === "research_v2_outcomes_required" ||
    input.result.reason === "admission_journal_unavailable" ||
    input.result.reason === "used_for_discovery_required"
  ) {
    return 1;
  }
  if (input.enabled && (input.barsCount === 0 || input.closedTradeCount === 0)) {
    return 1;
  }
  return 0;
}

export function printDiscoveryRunUsage(): void {
  console.log(`M8 discovery evolution orchestrator (operator-invoked, default disabled)

Usage:
  pnpm trader:discovery:run -- \\
    --org-id=<uuid> \\
    --campaign-id=<uuid> \\
    [--campaign-digest=<hex>] \\
    [--enable=1] \\
    [--operator-attestation=<digest>]

Environment:
  WAIA_TRADER_CLI=1
  WAIA_DB_BACKEND=postgres
  DATABASE_URL_POSTGRES=...

Separate source preparation (returns observation and stops before research execution):
  pnpm trader:discovery:run -- --prepare-source=1 --org-id=<Org0 uuid>
    --command-id=<stable command> --symbol=<BTCUSDT|ETHUSDT>
    --initial-record-index=<integer> --observation-bar-count=<integer>
    --gap-bar-count=<integer> --training-bar-count=<integer>
  Supply every flag in one invocation. Ordinary campaign flags cannot be mixed in.
  Host configuration: WAIA_RELEASE_SHA, WAIA_RESEARCH_SOURCE_DATABASE_URL,
    WAIA_RESEARCH_SOURCE_DATASET_ROOT, WAIA_RESEARCH_SOURCE_QUALIFICATION_PATH,
    WAIA_RESEARCH_SOURCE_VOLUME_PATH; WAIA_RESEARCH_SOURCE_REQUALIFICATION_PATH
    is required when source and runtime releases differ.
  The dedicated database login and current CLI/Org0 allowlist checks are required.

Separate issued-source DEVELOPMENT diagnostic (does not register an experiment or qualify it):
  pnpm trader:discovery:run -- --run-issued-training=1 --org-id=<Org0 uuid>
    --attempt-id=<issued V2 attempt uuid> --trial-index=<0..31>
    --max-bars=<1..4096> --max-bytes=<1..33554432>
  Requires WAIA_TRADER_CLI=1 and operator authorization. Prints only the
  diagnostic status and immutable identifiers/digests; uncertain commit exits nonzero.

Separate complete-family DEVELOPMENT selection (does not qualify a strategy):
  pnpm trader:discovery:run -- --select-issued-training=1 --org-id=<Org0 uuid>
    --attempt-id=<issued V2 attempt uuid> --max-bars=<1..4096>
    --max-bytes=<1..33554432> --max-trace-bytes=<1..33554432>
  Requires every declared trial to have a committed, verified, terminal-flat result.
  Missing or unfinished trials refuse the entire selection; this mode runs no trials.
  Requires WAIA_TRADER_CLI=1 and operator authorization; uncertain commit exits nonzero.

Separate immutable experiment registration (registration only; no execution or qualification):
  pnpm trader:discovery:run -- --register-experiment=1 --org-id=<Org0 uuid>
    --proposal-file=<absolute JSON file, max 256 KiB>
  Requires WAIA_TRADER_CLI=1 and operator authorization.

Separate issued-attempt registration (registration only; experiment and source must already exist):
  pnpm trader:discovery:run -- --register-issued-attempt=1 --org-id=<Org0 uuid>
    --spec-sha256=<64 lowercase hex> --source-run-id=<research-source-v1:64 lowercase hex>
    --command-id=<stable command>
  Requires WAIA_TRADER_CLI=1 and operator authorization. The two registration modes cannot be combined.

Separate DEVELOPMENT evaluation-source preparation (metadata-only; does not evaluate or disclose bars):
  pnpm trader:discovery:run -- --prepare-evaluation-source=1 --org-id=<Org0 uuid>
    --request-file=<absolute JSON file, max 256 KiB>
  The request names an already-issued training source and exact absolute validation/WF ranges.
  Requires WAIA_TRADER_CLI=1 and operator authorization. The request file contains selection metadata only.
`);
}

function parseFlags(argv: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      flags.set(body, true);
      continue;
    }
    flags.set(body.slice(0, eq), body.slice(eq + 1));
  }
  return flags;
}

const SOURCE_PREPARATION_FLAGS = new Set([
  "prepare-source",
  "org-id",
  "command-id",
  "symbol",
  "initial-record-index",
  "observation-bar-count",
  "gap-bar-count",
  "training-bar-count",
]);

function hasSourcePreparationFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--prepare-source" || arg.startsWith("--prepare-source="));
}

function hasEvaluationSourceFlag(argv: readonly string[]): boolean {
  return argv.some(arg => arg === "--prepare-evaluation-source" || arg.startsWith("--prepare-evaluation-source="));
}

function parseStrictInteger(value: string | boolean | undefined, flag: string): number {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:" + flag);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:" + flag);
  }
  return number;
}

export function parseDiscoverySourcePreparationArgs(argv: readonly string[]) {
  if (!hasSourcePreparationFlag(argv)) return null;
  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:POSITIONAL");
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals <= 0) throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:FLAG_FORMAT");
    const name = body.slice(0, equals);
    const value = body.slice(equals + 1);
    if (!SOURCE_PREPARATION_FLAGS.has(name)) {
      throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:UNKNOWN_FLAG");
    }
    if (seen.has(name)) throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:DUPLICATE_FLAG");
    seen.add(name);
    values.set(name, value);
  }
  if (values.get("prepare-source") !== "1") {
    throw new Error("SOURCE_PREPARATION_ARGUMENTS_INVALID:PREPARE_FLAG");
  }
  return captureResearchDevelopmentSourceRequestV1({
    organizationId: values.get("org-id"),
    commandId: values.get("command-id"),
    symbol: values.get("symbol"),
    initialRecordIndex: parseStrictInteger(
      values.get("initial-record-index"),
      "initial-record-index",
    ),
    observationBarCount: parseStrictInteger(
      values.get("observation-bar-count"),
      "observation-bar-count",
    ),
    gapBarCount: parseStrictInteger(values.get("gap-bar-count"), "gap-bar-count"),
    trainingBarCount: parseStrictInteger(values.get("training-bar-count"), "training-bar-count"),
  });
}

export async function runDiscoverySourcePreparationBranch(
  argv: readonly string[],
  input: {
    cliEnabled: boolean;
    authorize(): void;
    prepare(request: ReturnType<typeof captureResearchDevelopmentSourceRequestV1>): Promise<{
      status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY" | "COMMIT_UNCERTAIN";
      issuance: unknown;
      observation: unknown;
    }>;
    print(value: { status: string; issuance: unknown; observation: unknown }): void;
  },
): Promise<{ handled: boolean; exitCode: number; error?: string }> {
  if (!hasSourcePreparationFlag(argv)) return { handled: false, exitCode: 0 };
  if (!input.cliEnabled) {
    return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  }
  let request: ReturnType<typeof captureResearchDevelopmentSourceRequestV1>;
  try {
    request = parseDiscoverySourcePreparationArgs(argv)!;
  } catch {
    return { handled: true, exitCode: 1, error: "SOURCE_PREPARATION_ARGUMENTS_INVALID" };
  }
  try {
    input.authorize();
    const result = await input.prepare(request);
    input.print({
      status: result.status,
      issuance: result.issuance,
      observation: result.observation,
    });
    return { handled: true, exitCode: result.status === "COMMIT_UNCERTAIN" ? 1 : 0 };
  } catch {
    return { handled: true, exitCode: 1, error: "SOURCE_PREPARATION_FAILED" };
  }
}

const ISSUED_TRAINING_FLAGS = new Set([
  "run-issued-training",
  "org-id",
  "attempt-id",
  "trial-index",
  "max-bars",
  "max-bytes",
]);

function hasIssuedTrainingFlag(argv: readonly string[]): boolean {
  return argv.some(
    (arg) => arg === "--run-issued-training" || arg.startsWith("--run-issued-training="),
  );
}

function parseIssuedTrainingInteger(value: string | undefined): number {
  if (!value || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");
  return number;
}

export function parseDiscoveryIssuedTrainingArgs(argv: readonly string[]) {
  if (!hasIssuedTrainingFlag(argv)) return null;
  if (hasSourcePreparationFlag(argv)) throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");

  const seen = new Set<string>();
  const values = new Map<string, string>();
  for (const arg of argv) {
    if (!arg.startsWith("--")) throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");
    const body = arg.slice(2);
    const equals = body.indexOf("=");
    if (equals <= 0) throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");
    const name = body.slice(0, equals);
    const value = body.slice(equals + 1);
    if (!ISSUED_TRAINING_FLAGS.has(name) || seen.has(name) || value.length === 0) {
      throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");
    }
    seen.add(name);
    values.set(name, value);
  }
  if (values.get("run-issued-training") !== "1")
    throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");

  try {
    return captureResearchIssuedTrainingRequestV2({
      organizationId: values.get("org-id"),
      attemptId: values.get("attempt-id"),
      trialIndex: parseIssuedTrainingInteger(values.get("trial-index")),
      limits: {
        maxBars: parseIssuedTrainingInteger(values.get("max-bars")),
        maxBytes: parseIssuedTrainingInteger(values.get("max-bytes")),
      },
    });
  } catch {
    throw new Error("ISSUED_TRAINING_ARGUMENTS_INVALID");
  }
}

type IssuedTrainingOwnerTrace = NonNullable<
  Awaited<ReturnType<typeof runResearchIssuedTrainingDiagnosticPostgresV2>>["trace"]
>;
type IssuedTrainingCliResult = Readonly<{
  status: "COMMITTED" | "REPLAYED" | "CONFIRMED_AFTER_UNCERTAINTY" | "COMMIT_UNCERTAIN";
  trace: Readonly<
    Pick<IssuedTrainingOwnerTrace, "traceSha256" | "stageRunId" | "sourceIssuanceDigest">
  > | null;
}>;

export function buildIssuedTrainingCliSummary(result: IssuedTrainingCliResult) {
  const trace = result.trace;
  return {
    status: result.status,
    trace: trace
      ? {
          traceSha256: trace.traceSha256,
          stageRunId: trace.stageRunId,
          sourceIssuanceDigest: trace.sourceIssuanceDigest,
        }
      : null,
    scientificQualified: false as const,
    capitalEligible: false as const,
  };
}

export async function runDiscoveryIssuedTrainingBranch(
  argv: readonly string[],
  input: {
    cliEnabled: boolean;
    authorize(): void;
    run(
      request: NonNullable<ReturnType<typeof parseDiscoveryIssuedTrainingArgs>>,
    ): Promise<IssuedTrainingCliResult>;
    print(value: ReturnType<typeof buildIssuedTrainingCliSummary>): void;
  },
): Promise<{ handled: boolean; exitCode: number; error?: string }> {
  if (!hasIssuedTrainingFlag(argv)) return { handled: false, exitCode: 0 };
  if (!input.cliEnabled) return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };

  let request: NonNullable<ReturnType<typeof parseDiscoveryIssuedTrainingArgs>>;
  try {
    request = parseDiscoveryIssuedTrainingArgs(argv)!;
  } catch {
    return { handled: true, exitCode: 1, error: "ISSUED_TRAINING_ARGUMENTS_INVALID" };
  }

  try {
    input.authorize();
    const result = await input.run(request);
    const summary = buildIssuedTrainingCliSummary(result);
    input.print(summary);
    return { handled: true, exitCode: result.status === "COMMIT_UNCERTAIN" ? 1 : 0 };
  } catch {
    return { handled: true, exitCode: 1, error: "ISSUED_TRAINING_FAILED" };
  }
}

function hasTrainingFamilySelectionFlag(argv: readonly string[]): boolean {
  return argv.some(arg => arg === "--select-issued-training" || arg.startsWith("--select-issued-training="));
}

export function parseDiscoveryTrainingFamilySelectionArgs(argv: readonly string[]) {
  if (!hasTrainingFamilySelectionFlag(argv)) return null;
  const allowed = new Set(["select-issued-training", "org-id", "attempt-id", "max-bars", "max-bytes", "max-trace-bytes"]);
  const values = new Map<string, string>();
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1]!) || values.has(match[1]!)) throw new Error("FAMILY_SELECTION_ARGUMENTS_INVALID");
    values.set(match[1]!, match[2]!);
  }
  if (values.get("select-issued-training") !== "1") throw new Error("FAMILY_SELECTION_ARGUMENTS_INVALID");
  return captureResearchTrainingFamilyRequestV1({ organizationId: values.get("org-id"), attemptId: values.get("attempt-id"),
    limits: { maxBars: parseIssuedTrainingInteger(values.get("max-bars")), maxBytes: parseIssuedTrainingInteger(values.get("max-bytes")),
      maxTraceBytes: parseIssuedTrainingInteger(values.get("max-trace-bytes")) } });
}

export async function runDiscoveryTrainingFamilySelectionBranch(argv: readonly string[], input: {
  cliEnabled: boolean; authorize(): void;
  run: typeof selectResearchIssuedTrainingFamilyPostgresV1;
  print(value: Readonly<{ status: string; receiptDigest: string | null; selectedIndex: number | null;
    scientificQualified: false; capitalEligible: false }>): void;
}): Promise<{ handled: boolean; exitCode: number; error?: string }> {
  if (!hasTrainingFamilySelectionFlag(argv)) return { handled: false, exitCode: 0 };
  if (!input.cliEnabled) return { handled: true, exitCode: 1, error: "WAIA_TRADER_CLI_REQUIRED" };
  let request: NonNullable<ReturnType<typeof parseDiscoveryTrainingFamilySelectionArgs>>;
  try { request = parseDiscoveryTrainingFamilySelectionArgs(argv)!; }
  catch { return { handled: true, exitCode: 1, error: "FAMILY_SELECTION_ARGUMENTS_INVALID" }; }
  try {
    input.authorize();
    const result = await input.run(request);
    input.print({ status: result.status, receiptDigest: result.receipt?.contentDigest ?? null,
      selectedIndex: result.receipt?.selectedIndex ?? null, scientificQualified: false, capitalEligible: false });
    return { handled: true, exitCode: result.status === "COMMIT_UNCERTAIN" ? 1 : 0 };
  } catch { return { handled: true, exitCode: 1, error: "FAMILY_SELECTION_FAILED" }; }
}

async function main(): Promise<void> {
  if (process.env.WAIA_TRADER_CLI !== "1") {
    console.error(`${LOG_PREFIX} WAIA_TRADER_CLI=1 is required`);
    process.exit(1);
  }

  const argv = process.argv.slice(2);
  if (hasEvaluationSourceFlag(argv)) {
    const outcome = await runDiscoveryEvaluationSourceBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      readRequest: readResearchEvaluationSourceRequestFile,
      prepare: prepareResearchDevelopmentEvaluationSourcePostgresV1,
      print: summary => console.log(`${LOG_PREFIX} evaluation-source ${JSON.stringify(summary)}`),
    });
    if (outcome.error) console.error(`${LOG_PREFIX} ${outcome.error}`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (argv.some(arg => arg === "--register-experiment" || arg.startsWith("--register-experiment="))) {
    const outcome = await runDiscoveryExperimentRegistrationBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      readProposal: readResearchExperimentProposalFile,
      register: async (organizationId, proposal) =>
        registerResearchExperimentPostgresV1(getPostgresDrizzle(), requireOrgContext(organizationId), proposal),
      print: summary => console.log(`${LOG_PREFIX} experiment-registration ${JSON.stringify(summary)}`),
    });
    if (outcome.error) console.error(`${LOG_PREFIX} ${outcome.error}`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (argv.some(arg => arg === "--register-issued-attempt" || arg.startsWith("--register-issued-attempt="))) {
    const outcome = await runDiscoveryIssuedAttemptRegistrationBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      register: registerResearchIssuedAttemptPostgresV2,
      print: summary => console.log(`${LOG_PREFIX} issued-attempt-registration ${JSON.stringify(summary)}`),
    });
    if (outcome.error) console.error(`${LOG_PREFIX} ${outcome.error}`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (hasTrainingFamilySelectionFlag(argv)) {
    const outcome = await runDiscoveryTrainingFamilySelectionBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      run: selectResearchIssuedTrainingFamilyPostgresV1,
      print: summary => console.log(`${LOG_PREFIX} training-family ${JSON.stringify(summary)}`),
    });
    if (outcome.error) console.error(`${LOG_PREFIX} ${outcome.error}`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (hasIssuedTrainingFlag(argv)) {
    const outcome = await runDiscoveryIssuedTrainingBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      run: runResearchIssuedTrainingDiagnosticPostgresV2,
      print: (summary) => console.log(`${LOG_PREFIX} issued-training ${JSON.stringify(summary)}`),
    });
    if (outcome.error) console.error(`${LOG_PREFIX} ${outcome.error}`);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }
  if (hasSourcePreparationFlag(argv)) {
    const outcome = await runDiscoverySourcePreparationBranch(argv, {
      cliEnabled: process.env.WAIA_TRADER_CLI === "1",
      authorize: () => assertOperatorActionAllowed("authorize_discovery_run"),
      prepare: prepareResearchDevelopmentSourcePostgresV1,
      print: (value) => console.log(LOG_PREFIX + " source " + JSON.stringify(value)),
    });
    if (outcome.error) console.error(LOG_PREFIX + " " + outcome.error);
    if (outcome.exitCode !== 0) process.exitCode = outcome.exitCode;
    return;
  }

  const flags = parseFlags(argv);
  if (flags.has("help")) {
    printDiscoveryRunUsage();
    return;
  }

  const orgId = flags.get("org-id");
  const campaignId = flags.get("campaign-id");
  if (typeof orgId !== "string" || typeof campaignId !== "string") {
    printDiscoveryRunUsage();
    process.exit(1);
  }

  const enabled = flags.get("enable") === "1" || flags.get("enable") === true;
  const operatorAttestation =
    typeof flags.get("operator-attestation") === "string"
      ? (flags.get("operator-attestation") as string)
      : "";

  if (enabled) {
    assertOperatorActionAllowed("authorize_discovery_run");
    if (!operatorAttestation.trim()) {
      console.error(`${LOG_PREFIX} --operator-attestation is required when --enable=1`);
      process.exit(1);
    }
  }

  const context = requireOrgContext(orgId);
  const db = getPostgresDrizzle();

  const bars: [] = [];
  const closedTrades: [] = [];
  const result = await runDiscoveryEvolutionPass(db, {
    runContext: {
      schemaVersion: DISCOVERY_SCHEMA_VERSION,
      config: {
        ...DEFAULT_DISCOVERY_RUN_CONFIG,
        enabled,
        campaignId,
      },
      context,
      campaignRef: {
        campaignId,
        campaignDigest:
          typeof flags.get("campaign-digest") === "string"
            ? (flags.get("campaign-digest") as string)
            : "pending",
        state: enabled ? "ACTIVE" : "PROPOSED",
      },
      operatorAttestationDigest: operatorAttestation,
    },
    config: {
      ...DEFAULT_DISCOVERY_RUN_CONFIG,
      enabled,
      campaignId,
    },
    bars,
    closedTrades,
  });

  const record = buildDiscoveryRunRecord(result, { runId: campaignId });
  console.log(`${LOG_PREFIX} record`, JSON.stringify(record, null, 2));
  const exitCode = resolveDiscoveryRunExitCode({
    enabled,
    barsCount: bars.length,
    closedTradeCount: closedTrades.length,
    result,
  });
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

if (
  process.env.WAIA_TRADER_CLI === "1" ||
  hasSourcePreparationFlag(process.argv.slice(2)) ||
  hasEvaluationSourceFlag(process.argv.slice(2)) ||
  hasIssuedTrainingFlag(process.argv.slice(2)) ||
  process.argv.slice(2).some(arg => arg === "--register-experiment" || arg.startsWith("--register-experiment=")) ||
  process.argv.slice(2).some(arg => arg === "--register-issued-attempt" || arg.startsWith("--register-issued-attempt="))
) {
  main().catch((error: unknown) => {
    console.error(`${LOG_PREFIX} failed`, error);
    process.exit(1);
  });
}
