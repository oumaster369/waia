/**
 * DEE-415 / HTR-WP14 — forecast-decision bundle idempotency (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { persistForecastDecisionBundle } from "@/lib/trader/intelligence/forecast-decision/atomic-forecast-decision-bundle-repository-postgres";
import { ForecastDecisionIdempotencyConflictError } from "@/lib/trader/intelligence/forecast-decision/errors";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import {
  buildWp14Bundle,
  buildWp14PersistenceAuthorization,
  cleanupWp14AllRows,
  cleanupWp14Org,
  countWp14RowsForRun,
  seedWp14User,
  sealWp14PersistenceConflictFixture,
  WP14_PG_USER_A,
} from "./wp14-forecast-decision-test-helpers";
import { buildWp13Bundle } from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader forecast-decision idempotency (DEE-415 / HTR-WP14)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp14Org(url!, WP14_PG_USER_A);
      orgA = await seedWp14User(url!, WP14_PG_USER_A, "WP14 Forecast Decision Idempotency");
    });

    beforeEach(async () => {
      await cleanupWp14AllRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp14Org(url!, WP14_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    async function persistWp13AndWp14(runId: string, cycleId: string) {
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, runId, cycleId);
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);
      const bundle = buildWp14Bundle(orgA, runId, cycleId);
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        bundle,
        db,
        buildWp14PersistenceAuthorization(orgA, bundle),
      );
      return bundle;
    }

    it("accepts identical replay twice idempotently", async () => {
      const bundle = buildWp14Bundle(orgA, "wp14-idem-run", "0");
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, "wp14-idem-run", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        bundle,
        db,
        buildWp14PersistenceAuthorization(orgA, bundle),
      );
      await persistForecastDecisionBundle(
        { organizationId: orgA },
        bundle,
        db,
        buildWp14PersistenceAuthorization(orgA, bundle),
      );
      const counts = await countWp14RowsForRun(url!, orgA, "wp14-idem-run");
      expect(counts.decisions).toBe(1);
    });

    it("fails closed on same key with changed decision digest", async () => {
      await persistWp13AndWp14("wp14-conflict-decision", "1");
      const divergent = sealWp14PersistenceConflictFixture(orgA, {
        ...buildWp14Bundle(orgA, "wp14-conflict-decision", "1"),
        decision: {
          ...buildWp14Bundle(orgA, "wp14-conflict-decision", "1").decision,
          decisionClass: "TRADE" as const,
          contentDigest: "0".repeat(64),
        },
      });
      const db = getPostgresDrizzle();
      await expect(
        persistForecastDecisionBundle(
          { organizationId: orgA },
          divergent,
          db,
          buildWp14PersistenceAuthorization(orgA, divergent),
        ),
      ).rejects.toBeInstanceOf(ForecastDecisionIdempotencyConflictError);
    });

    it("concurrent identical insertions leave one semantic bundle and both succeed", async () => {
      const bundle = buildWp14Bundle(orgA, "wp14-concurrent-identical", "0");
      const db = getPostgresDrizzle();
      const wp13 = buildWp13Bundle(orgA, "wp14-concurrent-identical", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, wp13, db);
      const context = { organizationId: orgA };
      const results = await Promise.allSettled([
        persistForecastDecisionBundle(
          context,
          bundle,
          db,
          buildWp14PersistenceAuthorization(orgA, bundle),
        ),
        persistForecastDecisionBundle(
          context,
          bundle,
          db,
          buildWp14PersistenceAuthorization(orgA, bundle),
        ),
      ]);
      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      const counts = await countWp14RowsForRun(url!, orgA, "wp14-concurrent-identical");
      expect(counts.decisions).toBe(1);
    });
  },
);
