import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  KNOWLEDGE_NAVIGATOR_FORBIDDEN_CONSUMER_PREFIXES_V2,
  KNOWLEDGE_NAVIGATOR_RAW_MKB_INJECTION_SYMBOLS_V2,
  isKnowledgeNavigatorCapitalConsumerForbiddenV2,
} from "@/lib/trader/knowledge/navigator";

function walkTs(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTs(full));
      continue;
    }
    if (full.endsWith(".ts")) files.push(full);
  }
  return files;
}

describe("DEE-772 Knowledge Navigator consumer inventory", () => {
  it("forbids Decision/Risk/Execution/live/capital/holdout consumers", () => {
    expect(isKnowledgeNavigatorCapitalConsumerForbiddenV2("lib/trader/risk/foo.ts")).toBe(true);
    expect(isKnowledgeNavigatorCapitalConsumerForbiddenV2("lib/trader/execution/bar.ts")).toBe(
      true,
    );
    expect(
      isKnowledgeNavigatorCapitalConsumerForbiddenV2(
        "lib/trader/intelligence/forecast-v2/runtime.ts",
      ),
    ).toBe(false);
  });

  it("keeps the selector free of capital and mutation imports", () => {
    const source = readFileSync(
      resolve(process.cwd(), "lib/trader/knowledge/navigator/knowledge-navigator-v2.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@\/lib\/trader\/(risk|execution|live|capital)\//);
    expect(source).not.toContain("planKnowledgeEdgeVersionAppend");
    expect(source).not.toContain("queryMkbReadModel");
    expect(source).not.toContain("@/lib/trader/intelligence/decision");
  });

  it("does not allow Predictive Admission, Forecast or Decision to inject raw MKB as a Navigator substitute", () => {
    const roots = [
      "lib/trader/intelligence/predictive-admission",
      "lib/trader/intelligence/forecast-v2",
      "lib/trader/intelligence/decision-v2",
      "lib/trader/intelligence/decision-economics",
    ];
    const hits: string[] = [];
    for (const root of roots) {
      const abs = resolve(process.cwd(), root);
      if (!existsSync(abs)) continue;
      for (const file of walkTs(abs)) {
        const source = readFileSync(file, "utf8");
        if (
          KNOWLEDGE_NAVIGATOR_RAW_MKB_INJECTION_SYMBOLS_V2.some((symbol) => source.includes(symbol))
        ) {
          hits.push(relative(process.cwd(), file));
        }
      }
    }
    expect(hits).toEqual([]);
    expect(KNOWLEDGE_NAVIGATOR_FORBIDDEN_CONSUMER_PREFIXES_V2.length).toBeGreaterThan(0);
  });
});
