import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const REPO = process.cwd();
const LEGACY_SYMBOLS = [
  "adjustEdgeConfidenceFromVerification",
  "updateEdgeConfidenceFromVerification",
  "applyLegacyMkbHeuristicConfidenceAdjustment",
];
const ALLOWED = new Set([
  "lib/trader/knowledge/market-memory.ts",
  "lib/trader/knowledge/index.ts",
  "lib/trader/knowledge/legacy-mkb-mutation.ts",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === ".next") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (!full.endsWith(".ts") && !full.endsWith(".tsx")) continue;
    out.push(full);
  }
  return out;
}

describe("DEE-771 legacy mutation reachability", () => {
  it("keeps heuristic writers unreachable from production entrypoints", () => {
    const roots = ["app", "lib", "components", "scripts"].map((part) => join(REPO, part));
    const hits: string[] = [];
    for (const root of roots) {
      for (const file of walk(root)) {
        const rel = relative(REPO, file);
        if (ALLOWED.has(rel) || rel.startsWith("tests/")) continue;
        const source = readFileSync(file, "utf8");
        if (LEGACY_SYMBOLS.some((symbol) => source.includes(symbol))) {
          hits.push(rel);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("re-points the historical prerun bootstrap away from the heuristic", () => {
    const source = readFileSync(
      join(
        REPO,
        "lib/trader/research/execopp-qualification/historical-prerun-knowledge-bootstrap-v2.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("updateEdgeConfidenceFromVerification");
    expect(source).not.toContain("adjustEdgeConfidenceFromVerification");
    expect(source).toContain("verified: true");
  });
});
