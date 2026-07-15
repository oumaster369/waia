/**
 * DEE-415 / HTR-WP13 — intelligence bundle idempotency (opt-in).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getPostgresDrizzle, resetPostgresSingletonForTests } from "@/db/postgres-client";
import { persistIntelligenceCycleBundle } from "@/lib/trader/intelligence/records/atomic-cycle-bundle-repository-postgres";
import { IntelligenceRecordsIdempotencyConflictError } from "@/lib/trader/intelligence/records/errors";
import {
  buildWp13Bundle,
  cleanupWp13IntelligenceRows,
  cleanupWp13Org,
  countWp13RowsForRun,
  seedWp13User,
  WP13_PG_USER_A,
} from "./wp13-intelligence-test-helpers";

const integrationEnabled = process.env.WAIA_PG_INTEGRATION === "1";
const url = process.env.DATABASE_URL_POSTGRES?.trim();

describe.skipIf(!integrationEnabled || !url)(
  "postgres trader intelligence bundle idempotency (DEE-415 / HTR-WP13)",
  () => {
    let orgA: string;

    beforeAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      orgA = await seedWp13User(url!, WP13_PG_USER_A, "WP13 Intelligence Bundle Idempotency");
    });

    beforeEach(async () => {
      await cleanupWp13IntelligenceRows(url!, orgA);
    });

    afterAll(async () => {
      await cleanupWp13Org(url!, WP13_PG_USER_A);
      resetPostgresSingletonForTests();
    });

    it("accepts identical replay twice idempotently", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-idem-run", "0");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      const counts = await countWp13RowsForRun(url!, orgA, "wp13-idem-run");
      expect(counts.envelopes).toBe(1);
      expect(counts.convictions).toBe(1);
    });

    it("fails closed on same key with changed terminal reason digest", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-conflict-terminal", "1");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);

      const divergent = {
        ...bundle,
        envelope: {
          ...bundle.envelope,
          terminalReasonCode: "ALLOW_TRADING" as const,
          contentDigest: "0".repeat(64),
        },
      };
      await expect(
        persistIntelligenceCycleBundle({ organizationId: orgA }, divergent, db),
      ).rejects.toBeInstanceOf(IntelligenceRecordsIdempotencyConflictError);
    });

    it("fails closed on same key with changed hypothesis evidence digest", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-conflict-hypothesis", "2");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      if (bundle.hypotheses.length === 0) {
        return;
      }
      const divergent = {
        ...bundle,
        hypotheses: bundle.hypotheses.map((row, index) =>
          index === 0
            ? { ...row, evidenceDigest: "f".repeat(64), contentDigest: "1".repeat(64) }
            : row,
        ),
      };
      await expect(
        persistIntelligenceCycleBundle({ organizationId: orgA }, divergent, db),
      ).rejects.toBeInstanceOf(IntelligenceRecordsIdempotencyConflictError);
    });

    it("fails closed on same key with changed conviction value", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-conflict-conviction", "3");
      await persistIntelligenceCycleBundle({ organizationId: orgA }, bundle, db);
      const divergent = {
        ...bundle,
        conviction: {
          ...bundle.conviction,
          convictionValue: "9.999",
          contentDigest: "2".repeat(64),
        },
      };
      await expect(
        persistIntelligenceCycleBundle({ organizationId: orgA }, divergent, db),
      ).rejects.toBeInstanceOf(IntelligenceRecordsIdempotencyConflictError);
    });

    it("concurrent identical insertions leave one semantic bundle and both succeed", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-concurrent-identical", "0");
      const context = { organizationId: orgA };
      const results = await Promise.allSettled([
        persistIntelligenceCycleBundle(context, bundle, db),
        persistIntelligenceCycleBundle(context, bundle, db),
      ]);
      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
      const counts = await countWp13RowsForRun(url!, orgA, "wp13-concurrent-identical");
      expect(counts.envelopes).toBe(1);
      expect(counts.convictions).toBe(1);
    });

    it("concurrent divergent insertions yield one success and one conflict", async () => {
      const db = getPostgresDrizzle();
      const bundle = buildWp13Bundle(orgA, "wp13-concurrent-divergent", "1");
      const divergent = {
        ...bundle,
        envelope: {
          ...bundle.envelope,
          terminalReasonCode: "ALLOW_TRADING" as const,
          contentDigest: "3".repeat(64),
        },
      };
      const context = { organizationId: orgA };
      const results = await Promise.allSettled([
        persistIntelligenceCycleBundle(context, bundle, db),
        persistIntelligenceCycleBundle(context, divergent, db),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.status === "rejected" && rejected[0].reason).toBeInstanceOf(
        IntelligenceRecordsIdempotencyConflictError,
      );
      const counts = await countWp13RowsForRun(url!, orgA, "wp13-concurrent-divergent");
      expect(counts.envelopes).toBe(1);
      expect(counts.convictions).toBe(1);
    });
  },
);
