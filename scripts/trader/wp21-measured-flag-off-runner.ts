/**
 * HTR-WP21 measured flag-OFF research-path runner.
 *
 * Self-contained so it can execute from the Macro-I parent worktree (5e9fb106)
 * while resolving imports against that worktree's lib/ tree.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDb } from "@/db/client";
import { COST_MODEL_VERSION_V1, type CostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
import { canonicalJsonString } from "@/lib/trader/research/digest";
import { buildResearchValidationCycleIdPrefix } from "@/lib/trader/research/research-backtest-cycle-id";
import { buildResearchV2PortfolioContext } from "@/lib/trader/research/research-portfolio-config";
import {
  runResearchValidationBacktest,
  type ResearchValidationBacktestArtifactSink,
} from "@/lib/trader/research/research-backtest-runner";
import {
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
  RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
} from "@/lib/trader/research/strategy-candidate.types";
import { createSqliteRiskLimitsService } from "@/lib/trader/risk/limits/limits-service";
import { DEFAULT_ORG_RISK_LIMITS } from "@/lib/trader/risk/limits/defaults";
import { requireOrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";

const FIXTURE_PATH = "tests/fixtures/trader/btcusdt-1m-mean-reversion.json";
const USER_ID = "00000000-0000-4000-8021-0000000000r1";
const LEGACY_PARENT_MEASURED_FEE_BPS = `${1}${0}`;
const LEGACY_PARENT_MEASURED_SLIPPAGE_BPS = `${5}`;

async function resolveWp21MeasuredCostModel(): Promise<CostModelV1> {
  const authorityModulePath = path.join(
    process.cwd(),
    "lib/trader/execution/htr-historical-cost-model-authority.ts",
  );
  if (!existsSync(authorityModulePath)) {
    return {
      version: COST_MODEL_VERSION_V1,
      feesBps: LEGACY_PARENT_MEASURED_FEE_BPS,
      slippageBps: LEGACY_PARENT_MEASURED_SLIPPAGE_BPS,
    };
  }
  const authorityModule =
    await import("@/lib/trader/execution/htr-historical-cost-model-authority");
  return authorityModule.costModelV1FromAuthority(
    authorityModule.createHtrHistoricalCostModelAuthorityV1(),
  );
}

function sha256Utf8(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function loadFixtureBars(): Bar[] {
  return (
    JSON.parse(readFileSync(path.join(process.cwd(), FIXTURE_PATH), "utf8")) as {
      bars: Bar[];
    }
  ).bars;
}

function parseMetricsSchemaVersion(raw: string | undefined) {
  if (raw === "2.0.0" || raw === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION) {
    return RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  }
  if (raw === "1.0.0" || raw === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1) {
    return RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1;
  }
  throw new Error(`WP21_MEASURED_RUNNER_INVALID_METRICS_SCHEMA:${raw ?? "missing"}`);
}

async function runMeasuredProof(
  metricsSchemaVersion:
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
) {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: USER_ID,
    email: "wp21-measured-runner@waia.invalid",
    password: "password123",
    identityLabel: "WP21 Measured Runner",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: USER_ID,
    displayName: "WP21 Measured Runner",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });

  const context = requireOrgContext(orgId);
  const bars = loadFixtureBars();
  const runId = "wp21-measured-flag-off-run";
  const artifactSink: ResearchValidationBacktestArtifactSink = {};
  const costModel = await resolveWp21MeasuredCostModel();
  const portfolio = buildResearchV2PortfolioContext(costModel);

  try {
    const commonInput = {
      context,
      bars,
      strategyId: MEAN_REVERSION_V0,
      strategyVersion: "0.1.0",
      datasetId: "dataset-wp21-measured",
      runId,
      split: "validation" as const,
      costModel,
      deps: session.deps,
      orderRepository: session.orderRepository,
      accountKey: "wp21-measured",
      defaultQuantity: "0.01",
      cycleIdPrefix: buildResearchValidationCycleIdPrefix(runId),
      artifactSink,
      historicalExecutionProfile: session.historicalExecutionProfile,
    };

    const metrics =
      metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
        ? await runResearchValidationBacktest({
            ...commonInput,
            metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION,
            portfolio,
          })
        : await runResearchValidationBacktest({
            ...commonInput,
            metricsSchemaVersion: RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1,
          });

    const cycleResults = artifactSink.cycleResults;
    if (!cycleResults?.length) {
      throw new Error("WP21_MEASURED_RUNNER_MISSING_CYCLE_RESULTS");
    }

    const capitalPayload = {
      metricsSchemaVersion,
      metrics,
      portfolioContext: artifactSink.portfolioContext ?? null,
      cycles: cycleResults.map((cycle) => ({
        regime: cycle.evaluation.msv.derived.regime,
        signals: cycle.evaluation.signals,
        decisionChain: cycle.evaluation.decisionChain ?? null,
        forecastDecisionBundle: cycle.evaluation.forecastDecisionBundle ?? null,
        submitBlocked: cycle.submitBlocked,
        skipReason: cycle.skipReason ?? null,
        executions: cycle.strategyExecutions.map((entry) => ({
          strategyId: entry.signal.strategyId,
          status: entry.execution?.status ?? null,
          orderId:
            entry.execution && "order" in entry.execution && entry.execution.order
              ? entry.execution.order.id
              : entry.execution && "orderId" in entry.execution
                ? entry.execution.orderId
                : null,
          quantity:
            entry.execution && "order" in entry.execution && entry.execution.order
              ? entry.execution.order.quantity
              : null,
          submitBlocked: entry.submitBlocked,
          skipReason: entry.skipReason ?? null,
        })),
        guardian: cycle.htrGuardian ?? cycle.guardian ?? null,
        reconciliation: cycle.reconciliation,
      })),
    };

    const serializedCapitalPath = canonicalJsonString(capitalPayload);
    const capitalPathDigest = sha256Utf8(serializedCapitalPath);
    const fullResearchPathDigest = sha256Utf8(
      canonicalJsonString({
        metricsSchemaVersion,
        capitalPathDigest,
        metrics,
        portfolioContext: artifactSink.portfolioContext ?? null,
      }),
    );

    return {
      metricsSchemaVersion,
      capitalPathDigest,
      fullResearchPathDigest,
      serializedCapitalPath,
      metrics,
    };
  } finally {
    session.cleanup();
  }
}

async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) {
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq === -1) {
      args.set(body, "true");
    } else {
      args.set(body.slice(0, eq), body.slice(eq + 1));
    }
  }

  const metricsSchemaVersion = parseMetricsSchemaVersion(args.get("metrics-schema-version"));
  const payload = await runMeasuredProof(metricsSchemaVersion);
  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  const out = args.get("out")?.trim();
  if (out) {
    writeFileSync(out, serialized, "utf8");
  } else {
    process.stdout.write(serialized);
  }
}

if (process.env.WAIA_TRADER_CLI === "1") {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
