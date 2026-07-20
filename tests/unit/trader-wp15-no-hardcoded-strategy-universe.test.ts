import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const WP15_SOURCE_FILES = [
  "mkb-read-model.ts",
  "mkb-read-model-postgres.ts",
  "mkb-read-model-queries.ts",
  "mkb-read-model-source.ts",
  "mkb-knowledge-state.ts",
  "mkb-read-model.types.ts",
];

describe("trader wp15 no hardcoded strategy universe", () => {
  it("does not embed a fixed strategy allowlist in WP15 read-model modules", () => {
    const forbiddenPatterns = [
      /ALLOWED_STRATEGIES\s*=\s*\[/,
      /STRATEGY_UNIVERSE\s*=\s*\[/,
      /hardcodedStrategies/i,
      /"momentum_v1"\s*,\s*"mean_revert_v1"/,
    ];

    for (const file of WP15_SOURCE_FILES) {
      const source = readFileSync(join(process.cwd(), "lib/trader/knowledge", file), "utf8");
      for (const pattern of forbiddenPatterns) {
        expect(source).not.toMatch(pattern);
      }
    }
  });

  it("derives strategyId from decision records rather than a static universe", () => {
    const postgresSource = readFileSync(
      join(process.cwd(), "lib/trader/knowledge/mkb-read-model-postgres.ts"),
      "utf8",
    );
    expect(postgresSource).toContain("strategyId");
    expect(postgresSource).not.toContain("ALLOWED_STRATEGIES");
  });
});
