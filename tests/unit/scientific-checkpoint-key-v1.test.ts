// @vitest-environment node
import { mkdtempSync, realpathSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { deriveScientificCheckpointKeyV1, type ExpectedScientificCheckpointV1 } from "../../scripts/trader/scientific-checkpoint-key-v1";
import { createScientificCheckpointStoreV1 } from "../../scripts/trader/scientific-checkpoint-store-v1";

function expected(input: unknown): ExpectedScientificCheckpointV1 {
  return { releaseSha: "a".repeat(40), runtime: { node: process.version, os: process.platform, arch: process.arch },
    kind: "evidence", stage: "wf-forecast-batch-v1", input };
}
describe("DEE-991 original checkpoint-key mirror", () => {
  it.each([undefined, null, true, 42, -0, "Я𐍈", Buffer.from([0, 1, 255]),
    { b: [null, undefined, -0], a: { n: 2 } }, Array(3)].map(input => ({ input })))(
    "matches actual unmodified store publication on synthetic input %#", ({ input }) => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), "dee992-key-fixture-")));
      vi.stubEnv("WAIA_TRADER_CLI", "1");
      try {
        const e = expected(input);
        createScientificCheckpointStoreV1(root, e.releaseSha).evidence(e.stage, input, () => ({ synthetic: true }));
        expect(deriveScientificCheckpointKeyV1(e)).toBe(readdirSync(root).find(n => /^[a-f0-9]{64}$/.test(n)));
      } finally { vi.unstubAllEnvs(); rmSync(root, { recursive: true, force: true }); }
    });
  it("rejects getters/cycles/nonfinite numbers without evaluating a getter", () => {
    const getter = vi.fn(() => 1), object = Object.defineProperty({}, "x", { get: getter, enumerable: true });
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const v of [object, cycle, NaN, Infinity, new Map()])
      expect(() => deriveScientificCheckpointKeyV1(expected(v))).toThrow("KEY_REFUSED");
    expect(getter).not.toHaveBeenCalled();
  });
  it("retains signed zero and binds original release/runtime independently of evaluator", () => {
    expect(deriveScientificCheckpointKeyV1(expected(-0))).not.toBe(deriveScientificCheckpointKeyV1(expected(0)));
    const a = expected({ id: 1 }), b = expected({ id: 1 });
    b.runtime.node = "v1.2.3";
    expect(deriveScientificCheckpointKeyV1(a)).not.toBe(deriveScientificCheckpointKeyV1(b));
    b.runtime = a.runtime; b.releaseSha = "b".repeat(40);
    expect(deriveScientificCheckpointKeyV1(a)).not.toBe(deriveScientificCheckpointKeyV1(b));
  });
});
