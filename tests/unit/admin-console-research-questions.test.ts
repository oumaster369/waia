import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  REQUIRED_QUESTIONS,
  presentRequiredQuestion,
} from "@/lib/trader/admin-console/assistant/required-questions";
import { ADMIN_TOOLS } from "@/lib/trader/admin-console/assistant/tools";
import { compareResearchRuns } from "@/lib/trader/admin-console/research/compare-runs";
import {
  CYCLE_GROUPS,
  cycleStageIds,
  presentCycleStage,
} from "@/lib/trader/admin-console/research/cycle-catalog";
import { sqlTouchesHoldoutPayload } from "@/lib/trader/admin-console/research/holdout-firewall";
import {
  knownNoTradeCodes,
  noTradeCategory,
  noTradeEntersIncidentQueue,
} from "@/lib/trader/admin-console/research/no-trade-map";

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("admin console research and required questions", () => {
  it("maps every known reason and keeps a justified no-trade out of the incident queue", () => {
    for (const code of knownNoTradeCodes()) {
      const category = noTradeCategory(code);
      if (category != null) expect(category.startsWith("Прочее:")).toBe(false);
      expect(noTradeEntersIncidentQueue(code)).toBe(false);
    }
    expect(noTradeCategory("NO_TRADE")).toBe("нет экономического преимущества");
    expect(noTradeCategory("UNMAPPED_CODE")).toBe("Прочее: UNMAPPED_CODE");
    expect(noTradeEntersIncidentQueue("NO_TRADE")).toBe(false);
  });

  it("compares conditions before profitability", () => {
    const same = compareResearchRuns([
      {
        id: "a",
        dataset: "d",
        period: "p",
        costs: "c",
        version: "v",
        model: "m",
        netPnl: "1",
        forecastQuality: "q",
      },
      {
        id: "b",
        dataset: "d",
        period: "p",
        costs: "c",
        version: "v",
        model: "m",
        netPnl: "2",
        forecastQuality: "r",
      },
    ]);
    expect(same.ok).toBe(true);
    if (!same.ok) return;
    expect(same.sameConditions).toBe(true);
    expect(same.profitability.map((row) => row.netPnl)).toEqual(["1", "2"]);
    expect(same.forecastQuality.map((row) => row.forecastQuality)).toEqual(["q", "r"]);
    const different = compareResearchRuns([
      {
        id: "a",
        dataset: "d1",
        period: "p",
        costs: "c",
        version: "v",
        model: "m",
        netPnl: null,
        forecastQuality: null,
      },
      {
        id: "b",
        dataset: "d2",
        period: "p",
        costs: "c",
        version: "v",
        model: "m",
        netPnl: null,
        forecastQuality: null,
      },
    ]);
    expect(different.ok && different.differences).toEqual(["dataset"]);
    expect(compareResearchRuns([]).ok).toBe(false);
  });

  it("lists 23 stages in six groups and does not invent a missing stage", () => {
    expect(CYCLE_GROUPS).toHaveLength(6);
    expect(cycleStageIds()).toEqual(Array.from({ length: 23 }, (_, index) => index));
    expect(presentCycleStage(13)).toEqual({
      stageId: 13,
      status: "unavailable",
      reason: "NOT_PERSISTED_FOR_CYCLE",
    });
  });

  it("does not select a holdout payload from the console", () => {
    expect(sqlTouchesHoldoutPayload("select blind_holdout_payload from t")).toBe(true);
    const roots = ["lib/trader/admin-console", "app/api/trader/admin/console"];
    for (const root of roots) {
      for (const file of sourceFiles(path.join(process.cwd(), root))) {
        if (file.endsWith("holdout-firewall.ts")) continue;
        const source = readFileSync(file, "utf8");
        expect(sqlTouchesHoldoutPayload(source), file).toBe(false);
      }
    }
  });

  it("routes nine questions to read tools and keeps scope, period, currency, coverage, and citations", () => {
    expect(REQUIRED_QUESTIONS).toHaveLength(9);
    for (const question of REQUIRED_QUESTIONS) {
      for (const tool of question.tools) expect(ADMIN_TOOLS).toContain(tool);
      const presented = presentRequiredQuestion(question, {
        scope: "fleet",
        period: "7d",
        currency: "USDT",
      });
      expect(presented.scope).toBe("fleet");
      expect(presented.period).toBe("7d");
      expect(presented.currency).toBe("USDT");
      expect(presented.coverage.complete).toBe(false);
      expect(presented.citations).toEqual([]);
      expect(question.tools).not.toContain("place_order" as never);
    }
  });
});
