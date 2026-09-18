import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CAPITAL_BYPASS_CANONICAL_PLACE_ORDER_SITES_V2,
  CAPITAL_BYPASS_INVENTORY_V2,
  CAPITAL_BYPASS_PRODUCTION_PLACE_ORDER_CALL_SITES_V2,
  isCapitalBypassVenueWriteForbiddenV2,
  unresolvedWriteCapableCapitalBypassesV2,
} from "@/lib/trader/runtime-v2/capital-bypass-inventory-v2";

function walkTs(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkTs(full));
      continue;
    }
    if (full.endsWith(".ts") || full.endsWith(".tsx")) files.push(full);
  }
  return files;
}

describe("DEE-639 capital-bypass inventory", () => {
  it("has zero unresolved write-capable bypasses and one dual-write prohibition", () => {
    expect(unresolvedWriteCapableCapitalBypassesV2()).toEqual([]);
    const writeCapableCanonical = CAPITAL_BYPASS_INVENTORY_V2.filter(
      (seam) => seam.writeCapable && seam.disposition === "CANONICAL",
    );
    expect(writeCapableCanonical.map((seam) => seam.path).sort()).toEqual(
      [...CAPITAL_BYPASS_CANONICAL_PLACE_ORDER_SITES_V2].sort(),
    );
    expect(
      CAPITAL_BYPASS_INVENTORY_V2.filter(
        (seam) => seam.kind === "orchestrator" && seam.writeCapable,
      ),
    ).toEqual([]);
  });

  it("keeps production placeOrder call sites inside the canonical Execution set", () => {
    const root = process.cwd();
    const sites: string[] = [];
    for (const tree of ["app", "lib", "scripts"]) {
      for (const file of walkTs(resolve(root, tree))) {
        const path = relative(root, file);
        if (path === "scripts/trader/validate-execution-v2-consumer-graph.ts") continue;
        const source = readFileSync(file, "utf8");
        if (/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\.placeOrder\s*\(/.test(source)) {
          sites.push(path);
        }
      }
    }
    expect(sites.sort()).toEqual([...CAPITAL_BYPASS_PRODUCTION_PLACE_ORDER_CALL_SITES_V2].sort());
  });

  it("forbids Forecast/Decision/Risk/Guardian/Billing/Research/UI from venue-write prefixes", () => {
    expect(isCapitalBypassVenueWriteForbiddenV2("lib/trader/risk/allowance.ts")).toBe(true);
    expect(isCapitalBypassVenueWriteForbiddenV2("lib/trader/billing/invoice.ts")).toBe(true);
    expect(
      isCapitalBypassVenueWriteForbiddenV2("lib/trader/execution/v2/connector-dispatch.ts"),
    ).toBe(false);

    const root = process.cwd();
    const hits: string[] = [];
    for (const tree of [
      "app",
      "lib/trader/intelligence",
      "lib/trader/risk",
      "lib/trader/guardian",
      "lib/trader/billing",
      "lib/trader/discovery",
      "lib/trader/research",
    ]) {
      const abs = resolve(root, tree);
      for (const file of walkTs(abs)) {
        const path = relative(root, file);
        if (!isCapitalBypassVenueWriteForbiddenV2(path)) continue;
        const source = readFileSync(file, "utf8");
        if (
          source.includes("connector.placeOrder(") ||
          source.includes('from "@/lib/trader/execution/v2/connector-dispatch"')
        ) {
          hits.push(path);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("keeps StrategySignal mappers unable to place venue orders", () => {
    for (const file of [
      "lib/trader/live/signal-to-live-order.ts",
      "lib/trader/paper/signal-to-order.ts",
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      expect(source).not.toMatch(/placeOrder\s*\(/);
    }
  });
});
