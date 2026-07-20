import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  WP21_PROHIBITED_SAME_RUN_CONSUMER_SURFACES,
  buildWp21SameRunConsumerGraph,
} from "@/lib/trader/intelligence/epistemic/wp21-same-run-consumer-graph";

function listSourceFiles(root: string): string[] {
  if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
    return [];
  }
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(full));
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("trader wp21 same-run no-feedback proof", () => {
  it("exports a machine-readable consumer graph with zero capital-path consumers", () => {
    const graph = buildWp21SameRunConsumerGraph();
    expect(graph.capitalPathConsumers).toEqual([]);
    expect(graph.prohibitedSameRunConsumers.length).toBeGreaterThan(0);
  });

  it("does not import WP21 epistemic outputs into prohibited same-run decision surfaces", () => {
    const repoRoot = process.cwd();
    const offenders: string[] = [];

    for (const surface of WP21_PROHIBITED_SAME_RUN_CONSUMER_SURFACES) {
      const abs = path.join(repoRoot, surface);
      for (const file of listSourceFiles(abs)) {
        const content = readFileSync(file, "utf8");
        if (
          content.includes("knowledge-confidence-update") ||
          content.includes("outcome-resolution-read-port") ||
          content.includes("runWp21TerminalSeam") ||
          content.includes("runWp21CycleSeam")
        ) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
