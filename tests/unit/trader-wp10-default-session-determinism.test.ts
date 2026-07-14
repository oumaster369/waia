/**
 * HTR-WP10 — default in-memory research session determinism (no caller-pinned newId).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runWp10DefaultSessionReplay } from "@/tests/unit/helpers/wp10-replay-fixture";

export const HTR_WP10_EVIDENCE_DIR = path.join(
  process.cwd(),
  "replay-runs/RI-P7/htr-wp10-determinism-nolookahead",
);

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("HTR-WP10 default session determinism", () => {
  it("produces byte-identical metrics, digests, and IDs across two isolated replays", async () => {
    const first = await runWp10DefaultSessionReplay("2026-01-01T00:00:00.000Z");
    await delay(250);
    const second = await runWp10DefaultSessionReplay("2099-12-31T23:59:59.999Z");

    expect(first.cycleCount).toBeGreaterThan(0);
    expect(second.cycleCount).toBe(first.cycleCount);
    expect(second.closedTradeCount).toBe(first.closedTradeCount);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.decisionTraceDigest).toBe(first.decisionTraceDigest);
    expect(second.reproDigest).toBe(first.reproDigest);
    expect(second.orderIds).toEqual(first.orderIds);
    expect(second.fillIds).toEqual(first.fillIds);
    expect(second.fillExecutedAtIso).toEqual(first.fillExecutedAtIso);
    expect(second.featureSetIds).toEqual(first.featureSetIds);
    expect(second.strategySignalIds).toEqual(first.strategySignalIds);

    mkdirSync(HTR_WP10_EVIDENCE_DIR, { recursive: true });
    const manifest = {
      schemaVersion: "htr_wp10_determinism_manifest_v1",
      property: "default-session-byte-identical-replay",
      runCount: 2,
      cycleCount: first.cycleCount,
      decisionTraceDigest: first.decisionTraceDigest,
      reproDigest: first.reproDigest,
      artifactDigest: createHash("sha256")
        .update(
          JSON.stringify({
            decisionTraceDigest: first.decisionTraceDigest,
            reproDigest: first.reproDigest,
            orderIds: first.orderIds,
            fillIds: first.fillIds,
          }),
          "utf8",
        )
        .digest("hex"),
    };
    writeFileSync(
      path.join(HTR_WP10_EVIDENCE_DIR, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    writeFileSync(
      path.join(HTR_WP10_EVIDENCE_DIR, "README.md"),
      `# HTR-WP10 determinism + no-lookahead qualification

Evidence for deterministic default replay session (HTR-WP10).

## Reproduce

\`\`\`bash
pnpm test --run tests/unit/trader-wp10-default-session-determinism.test.ts \\
  tests/unit/trader-wp10-clock-injection.test.ts \\
  tests/unit/trader-wp10-order-id-determinism.test.ts \\
  tests/unit/trader-wp10-lifecycle-determinism.test.ts \\
  tests/unit/trader-wp10-digest-stability.test.ts \\
  tests/unit/trader-wp10-no-lookahead.test.ts
\`\`\`

## Manifest digest

\`${manifest.artifactDigest}\`
`,
      "utf8",
    );
  });
});
