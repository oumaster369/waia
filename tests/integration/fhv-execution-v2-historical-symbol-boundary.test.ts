import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { describe, expect, it } from "vitest";

import { getRawSqliteDatabase } from "@/db/client";
import { parseOpeningCausalLineageV1 } from "@/lib/trader/lifecycle/opening-causal-lineage-v1";
import { seedFhvHistoricalExecutionSession } from "@/lib/trader/observability/fhv-historical-execution-session";
import {
  bindFhvTestOnlyExecutionV2HistoricalSession,
  getFhvTestOnlyExecutionV2AuthorityMetrics,
} from "@/tests/fhv/official-scale/blocking/fhv-official-scale-harness";

const enabled =
  process.env.WAIA_PG_INTEGRATION === "1" &&
  process.env.FHV_TEST_ONLY_EXECUTION_V2_AUTHORITY === "1" &&
  process.env.DATABASE_URL_POSTGRES?.trim() !== undefined;

describe.runIf(enabled)("FHV Execution V2 historical symbol boundary", () => {
  it.each([
    ["BTC/USDT", "BTCUSDT"],
    ["ETH/USDT", "ETHUSDT"],
  ])("binds %s through venue authority and research projection", async (
    historicalSymbol,
    venueSymbol,
  ) => {
    const organizationId = randomUUID();
    const seeded = await seedFhvHistoricalExecutionSession({
      organizationId,
      operatorId: randomUUID(),
    });
    const bound = await bindFhvTestOnlyExecutionV2HistoricalSession(seeded);
    const sql = postgres(process.env.DATABASE_URL_POSTGRES!, { max: 1 });
    try {
      const result = await bound.session.deps.execution.submitOrder(bound.context, {
        clientOrderId: `fhv-symbol-${randomUUID()}`,
        idempotencyKey: `fhv-symbol-${randomUUID()}`,
        executionMode: "mock",
        symbol: historicalSymbol,
        side: "buy",
        type: "market",
        quantity: "0.01",
        referencePrice: "100",
        accountKey: "fhv-symbol-boundary",
      });
      expect(result.status).toBe("submitted");
      if (result.status !== "submitted") throw new Error("expected modeled submission");

      const projectedOrder = await bound.session.orderRepository.getOrderById(
        bound.context,
        result.order.id,
      );
      expect(projectedOrder).not.toBeNull();
      expect(projectedOrder!.symbol).toBe(historicalSymbol);
      const projection = getRawSqliteDatabase().prepare(`
        SELECT symbol,
               opening_causal_lineage_json AS openingCausalLineageJson,
               opening_causal_lineage_digest AS openingCausalLineageDigest
        FROM trader_orders
        WHERE id = ? AND organization_id = ?
      `).get(result.order.id, organizationId) as {
        symbol: string;
        openingCausalLineageJson: string;
        openingCausalLineageDigest: string;
      };
      expect(projection.symbol).toBe(historicalSymbol);
      const projectionLineage = parseOpeningCausalLineageV1(
        projection.openingCausalLineageJson,
      );
      expect(projectionLineage.symbol).toBe(historicalSymbol);
      expect(projectionLineage.contentDigest).toBe(projection.openingCausalLineageDigest);

      const authorityRows = await sql<{
        symbol: string;
        opening_causal_lineage_json: string;
        opening_causal_lineage_digest: string;
      }[]>`
        SELECT symbol, opening_causal_lineage_json, opening_causal_lineage_digest
        FROM trader_orders
        WHERE organization_id = ${organizationId}::uuid
      `;
      expect(authorityRows).toHaveLength(1);
      const authority = authorityRows[0]!;
      const authorityLineage = parseOpeningCausalLineageV1(
        authority.opening_causal_lineage_json,
      );
      expect(authority.symbol).toBe(venueSymbol);
      expect(authorityLineage.symbol).toBe(venueSymbol);
      expect(authorityLineage.contentDigest).toBe(authority.opening_causal_lineage_digest);
      expect(authorityLineage.riskAllowanceId).toBe(projectionLineage.riskAllowanceId);
      expect(authorityLineage.canonicalCausalLineageDigest).toBe(
        projectionLineage.canonicalCausalLineageDigest,
      );
      expect(authorityLineage.contentDigest).not.toBe(projectionLineage.contentDigest);

      expect(getFhvTestOnlyExecutionV2AuthorityMetrics()).toEqual({
        allowanceClaims: 1,
        boundAttempts: 1,
        modeledPlacements: 1,
        venueAcceptedReports: 1,
        legacySubmissions: 0,
      });
    } finally {
      bound.cleanup();
      await sql.end({ timeout: 5 });
    }
  });
});
