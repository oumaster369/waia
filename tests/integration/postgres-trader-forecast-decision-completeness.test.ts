/**
 * DEE-415 / HTR-WP14 — forecast-decision chain completeness (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { assertForecastDecisionChainComplete } from "@/lib/trader/intelligence/forecast-decision/forecast-decision-completeness";
import { HtrWp14DecisionChainIncompleteError } from "@/lib/trader/intelligence/forecast-decision/errors";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import {
  cleanupWp14AllRows,
  cleanupWp14Org,
  seedWp14User,
  WP14_PG_USER_A,
} from "./wp14-forecast-decision-test-helpers";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader forecast-decision completeness (DEE-415 / HTR-WP14)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp14Org(url!, WP14_PG_USER_A);
      orgA = await seedWp14User(url!, WP14_PG_USER_A, "WP14 Forecast Decision Completeness");
    });

    beforeEach(async () => {
      await cleanupWp14AllRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp14Org(url!, WP14_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("passes when WP13 envelope and WP14 decision both exist", async () => {
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, "wp14-complete", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);
      const { buildWp14Bundle, buildWp14PersistenceAuthorization } =
        await import("./wp14-forecast-decision-test-helpers");
      const { persistForecastDecisionBundle } =
        await import("@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres");
      const bundle = buildWp14Bundle(orgA, "wp14-complete", "0");
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        bundle,
        db,
        buildWp14PersistenceAuthorization(orgA, bundle),
      );

      await expect(
        assertForecastDecisionChainComplete(
          { organizationId: orgA },
          {
            organizationId: orgA,
            runId: "wp14-complete",
            cycleId: "0",
            symbol: "BTC/USDT",
          },
          { db },
        ),
      ).resolves.toBeUndefined();
    });

    it("fails closed when WP13 committed but WP14 decision missing", async () => {
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, "wp14-incomplete", "1");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);

      await expect(
        assertForecastDecisionChainComplete(
          { organizationId: orgA },
          {
            organizationId: orgA,
            runId: "wp14-incomplete",
            cycleId: "1",
            symbol: "BTC/USDT",
            wp13Persisted: true,
          },
          { db },
        ),
      ).rejects.toBeInstanceOf(HtrWp14DecisionChainIncompleteError);
    });
  },
);
