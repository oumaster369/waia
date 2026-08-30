import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertConnectorReferenceClosure,
  detectConnectorMethodReferencesInSource,
} from "@/scripts/trader/validate-reality-v2-consumer-graph";

const ROOT = process.cwd();
const INVENTORY = join(ROOT, "docs/ai-trader/reality-v2-source-consumer-inventory.json");
const VALIDATOR = join(ROOT, "scripts/trader/validate-reality-v2-consumer-graph.ts");

describe("Reality V2 whole-repository source/consumer closure (DEE-679)", () => {
  it("passes the pinned repository graph validator", () => {
    const output = execFileSync(process.execPath, ["--import", "tsx", VALIDATOR], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual(expect.objectContaining({
      status: "PASS",
      sources: 153,
      consumers: 116,
      connectorReferences: 25,
      sourceContentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
      consumerContentDigestHex: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
  });

  it("binds historical, synthetic, modelled, and Execution V2 barrel surfaces into closure", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      sourceDiscovery: { roots: string[]; additionalFiles: string[] };
      consumerDiscovery: {
        additionalFiles: string[];
        productionExtensions: string[];
        connectorMethods: string[];
      };
    };
    expect(inventory.sourceDiscovery.roots).toContain("lib/trader/market-data");
    expect(inventory.sourceDiscovery.roots).toContain("lib/trader/execution/v2");
    expect(inventory.sourceDiscovery.additionalFiles).toContain("lib/trader/execution/index.ts");
    expect(inventory.consumerDiscovery.additionalFiles).toEqual(expect.arrayContaining([
      "lib/trader/execution/index.ts",
      "lib/trader/execution/v2/index.ts",
    ]));
    expect(inventory.consumerDiscovery.productionExtensions).toEqual(expect.arrayContaining([
      ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs",
    ]));
    expect(inventory.consumerDiscovery.connectorMethods).toContain("placeOrder");
  });

  it("detects alias, bind, destructure, bracket, optional, direct-client, and indirect references", () => {
    const methods = [
      "getAccountInfo", "getBalances", "getPositions", "getOpenOrders",
      "getOrder", "getTradeHistory", "placeOrder",
    ];
    const references = detectConnectorMethodReferencesInSource(`
      const alias = connector.getBalances;
      const bound = connector.placeOrder.bind(connector);
      const { getPositions: positions, getOpenOrders } = connector;
      const bracket = connector["getOrder"];
      this.client?.getTradeHistory?.();
      forward(inner.getAccountInfo);
      alias(); bound(input); positions(); getOpenOrders(); bracket(id);
    `, "lib/mutated-consumer.ts", methods);
    expect(references.map(({ method, form }) => `${method}:${form}`).sort()).toEqual([
      "getAccountInfo:PROPERTY",
      "getBalances:PROPERTY",
      "getOpenOrders:DESTRUCTURE",
      "getOrder:BRACKET",
      "getPositions:DESTRUCTURE",
      "getTradeHistory:OPTIONAL_PROPERTY",
      "placeOrder:PROPERTY",
    ]);
    expect(() => assertConnectorReferenceClosure(references, [])).toThrow(
      /connector reference closure drift/,
    );
  });

  it("keeps DEE-620 and DEE-634 explicit and separate", () => {
    const inventory = JSON.parse(readFileSync(INVENTORY, "utf8")) as {
      separateIssues: Record<string, string>;
      canonicalSourceKinds: string[];
    };
    expect(Object.keys(inventory.separateIssues).sort()).toEqual(["DEE-620", "DEE-634"]);
    expect(inventory.canonicalSourceKinds).toEqual([
      "EXECUTION_REPORT_V2",
      "HTX_SPOT_ORDER_REST",
      "HTX_SPOT_FILL_REST",
      "HTX_SPOT_BALANCE_REST",
      "HTX_SPOT_ACCOUNT_REST",
    ]);
  });
});
