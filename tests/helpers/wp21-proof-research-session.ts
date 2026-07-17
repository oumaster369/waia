import { getDb } from "@/db/client";
import { createCostModelV1 } from "@/lib/trader/execution/cost-model";
import { MEAN_REVERSION_V0, type Bar } from "@/lib/trader/intelligence/types";
import { createInMemoryResearchBacktestSession } from "@/lib/trader/research/create-in-memory-research-backtest-session";
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
import { requireOrgContext, type OrgContext } from "@/lib/waia-core/scope/org-context";
import { ensureUserCoreSeedSqlite } from "@/lib/waia-core/provisioning/sqlite";
import { insertEmailPasswordUser } from "@/tests/helpers/test-users";
import {
  digestResearchValidationCapitalPath,
  loadWp21ProofFixtureBars,
  WP21_PROOF_STRATEGY_VERSION,
  WP21_PROOF_USER_ID,
} from "@/lib/trader/intelligence/epistemic/wp21-proof-harness";
import { splitBarsThreeWay } from "@/lib/trader/market-data/research-dataset";
import { buildResearchIntegrationBars } from "@/tests/helpers/build-research-integration-bars";

export async function createWp21ProofResearchSession() {
  const session = await createInMemoryResearchBacktestSession();
  const db = getDb();
  insertEmailPasswordUser(db, {
    id: WP21_PROOF_USER_ID,
    email: "wp21-proof-session@waia.invalid",
    password: "password123",
    identityLabel: "WP21 Proof Session",
  });
  const orgId = ensureUserCoreSeedSqlite(db, {
    userId: WP21_PROOF_USER_ID,
    displayName: "WP21 Proof Session",
  });
  await createSqliteRiskLimitsService(db).upsertLimitsForOrg(requireOrgContext(orgId), {
    ...DEFAULT_ORG_RISK_LIMITS,
  });
  return { session, context: requireOrgContext(orgId) };
}

export async function runWp21ProofResearchValidation(input: {
  context: OrgContext;
  session: Awaited<ReturnType<typeof createWp21ProofResearchSession>>["session"];
  metricsSchemaVersion:
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION_V1
    | typeof RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION;
  runId: string;
  bars?: readonly Bar[];
  wp21Fields?: Record<string, unknown>;
}) {
  const bars = input.bars ?? splitBarsThreeWay(buildResearchIntegrationBars()).validation;
  const artifactSink: ResearchValidationBacktestArtifactSink = {};
  const costModel = createCostModelV1("10", "5");
  const portfolio = buildResearchV2PortfolioContext(costModel);
  const commonInput = {
    context: input.context,
    bars,
    strategyId: MEAN_REVERSION_V0,
    strategyVersion: WP21_PROOF_STRATEGY_VERSION,
    datasetId: "dataset-wp21-proof",
    runId: input.runId,
    split: "validation" as const,
    costModel,
    deps: input.session.deps,
    orderRepository: input.session.orderRepository,
    accountKey: "wp21-proof",
    defaultQuantity: "0.01",
    cycleIdPrefix: buildResearchValidationCycleIdPrefix(input.runId),
    artifactSink,
    historicalExecutionProfile: input.session.historicalExecutionProfile,
    ...input.wp21Fields,
  };

  const metrics =
    input.metricsSchemaVersion === RESEARCH_VALIDATION_METRICS_SCHEMA_VERSION
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
    throw new Error("WP21_PROOF_MISSING_CYCLE_RESULTS");
  }

  const digests = digestResearchValidationCapitalPath({
    metricsSchemaVersion: input.metricsSchemaVersion,
    metrics,
    cycleResults,
    portfolioContext: artifactSink.portfolioContext,
  });

  return {
    metrics,
    cycleResults,
    artifactSink,
    ...digests,
  };
}
