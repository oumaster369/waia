import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TrongridIntelligenceAdapter } from "@/lib/trader/market-data/adapters/trongrid-intelligence-adapter";

describe("TronGrid AI-TRADER intelligence boundary", () => {
  it("adapter uses AI_TRADER_TRONGRID_API_KEY env only", () => {
    const adapterPath = path.join(
      process.cwd(),
      "lib/trader/market-data/adapters/trongrid-intelligence-adapter.ts",
    );
    const clientPath = path.join(
      process.cwd(),
      "lib/trader/connectors/trongrid-intelligence/trongrid-intelligence-client.ts",
    );
    const adapterSource = readFileSync(adapterPath, "utf8");
    const clientSource = readFileSync(clientPath, "utf8");

    expect(adapterSource).not.toMatch(/\bTRONGRID_API_KEY\b/);
    expect(clientSource).toContain("AI_TRADER_TRONGRID_API_KEY");
    expect(clientSource).not.toMatch(/\bTRONGRID_API_KEY\b/);
  });

  it("returns UNAVAILABLE when AI_TRADER_TRONGRID_API_KEY is missing", async () => {
    const prior = process.env.AI_TRADER_TRONGRID_API_KEY;
    delete process.env.AI_TRADER_TRONGRID_API_KEY;

    const adapter = new TrongridIntelligenceAdapter({});
    const observations = await adapter.fetchObservations({
      evaluatedAt: "2026-01-01T14:00:00.000Z",
    });

    if (prior !== undefined) {
      process.env.AI_TRADER_TRONGRID_API_KEY = prior;
    }

    expect(observations.length).toBeGreaterThan(0);
    expect(observations[0]?.health).toBe("UNAVAILABLE");
    expect(observations[0]?.payload.reason).toBeTruthy();
  });
});
