import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

import {
  canonicalizeSemanticJsonString,
  computeSemanticSha256Hex,
} from "@/lib/trader/intelligence/htr-semantic-canonical-json";
import { createForecastV2DurableProducerV1 } from
  "@/lib/trader/intelligence/outcome-resolution/epistemic-closure-runtime";
import type { Bar } from "@/lib/trader/intelligence/types";

describe("Forecast V2 durable PIT bar parameterization", () => {
  it("binds the canonical bar as JSON text instead of passing an object parameter", async () => {
    const bar: Bar = {
      symbol: "BTCUSDT",
      interval: "1m",
      open: "100.00",
      high: "101.00",
      low: "99.00",
      close: "100.50",
      volume: "2.00",
      barOpenTime: "2026-08-01T00:00:00.000Z",
      barCloseTime: "2026-08-01T00:01:00.000Z",
    };
    const calls: Array<{ statement: string; values: readonly unknown[] }> = [];
    const json = vi.fn(() => {
      throw new Error("plain object reached postgres.js JSON parameterization");
    });
    const sqlTag = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const statement = strings.join("?");
      calls.push({ statement, values });
      for (const value of values) {
        if (value !== null && typeof value === "object") {
          throw new Error("plain object reached postgres.js parameterization");
        }
      }
      if (statement.includes("INSERT INTO trader_forecast_pit_bar_v2")) {
        return [{ bar_content_digest: computeSemanticSha256Hex(bar) }];
      }
      return [];
    });
    const sql = Object.assign(sqlTag, { json }) as unknown as postgres.Sql;
    const producer = createForecastV2DurableProducerV1({
      sql,
      kmGlobalAnchorSetDigestHex: "a".repeat(64),
      priorMachineRecommendedConfidence: "0.5000",
      provenance: {
        codeSha: "b".repeat(40),
        datasetContentDigest: "c".repeat(64),
        profileDigest: "d".repeat(64),
        canonicalizer: "HTR_SEMANTIC_CANONICAL_JSON_V1",
      },
      resolveVolumeAuthorityReceipt: () => {
        throw new Error("terminal resolution is not exercised");
      },
    });

    await expect(producer.processCycle({
      organizationId: "11111111-1111-4111-8111-111111111111",
      runId: "pit-json-parameterization",
      cycleId: "cycle-0",
      pitAnchor: bar.barCloseTime,
      bars: [bar],
      sequence: 0,
      outcome: null,
    })).resolves.toEqual({ pendingCount: 0 });

    expect(json).not.toHaveBeenCalled();
    const insert = calls.find((call) =>
      call.statement.includes("INSERT INTO trader_forecast_pit_bar_v2"),
    );
    expect(insert?.statement).toContain("?::text::jsonb");
    expect(insert?.values.at(-1)).toBe(canonicalizeSemanticJsonString(bar));
    expect(insert?.values.every((value) => value === null || typeof value !== "object")).toBe(true);
  });
});
