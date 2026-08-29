import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const inventory = JSON.parse(
  readFileSync(join(root, "docs/ai-trader/decision-v2-capital-authority-consumer-inventory.json"), "utf8"),
) as {
  discoveryRoots: string[];
  productionExtensions: string[];
  legacyMarkers: string[];
  canonicalMarker: string;
  legacyReferenceAllowlist: Array<{ file: string }>;
  canonicalReferences: string[];
};

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function productionSources(): string[] {
  const extensions = new Set(inventory.productionExtensions);
  return inventory.discoveryRoots
    .flatMap((directory) => filesUnder(join(root, directory)))
    .filter((file) => extensions.has(extname(file)));
}

function references(markers: readonly string[]): string[] {
  return productionSources()
    .filter((file) => markers.some((marker) => readFileSync(file, "utf8").includes(marker)))
    .map((file) => relative(root, file))
    .sort();
}

describe("DEE-778 Decision V2 whole-repository consumer graph", () => {
  it("pins every remaining legacy mapper reference to an explicit non-capital disposition", () => {
    expect(references(inventory.legacyMarkers)).toEqual(
      inventory.legacyReferenceAllowlist.map(({ file }) => file).sort(),
    );
  });

  it("pins the complete canonical authority reference graph", () => {
    expect(references([inventory.canonicalMarker])).toEqual([...inventory.canonicalReferences].sort());
  });

  it("keeps normal live ingress mapper-free and paper legacy mapping after its terminal V2 branch", () => {
    const live = readFileSync(join(root, "lib/trader/live/run-live-cycle.ts"), "utf8");
    const paper = readFileSync(join(root, "lib/trader/paper/paper-cycle-runner.ts"), "utf8");
    expect(inventory.legacyMarkers.some((marker) => live.includes(marker))).toBe(false);
    expect(paper.indexOf('executionMode === "paper"')).toBeLessThan(
      paper.indexOf("mapSignalToSubmitOrder({"),
    );
  });
});
