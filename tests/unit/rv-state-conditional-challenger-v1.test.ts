import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  assertSourceCorpusUnique,
  assertTerminalMarginalCoherenceV1,
  assignRvStateTertileV1,
  challengerModelRegistryV1,
  CHALLENGER_EXECUTOR_READY_STATUS,
  fitRvStateConditionalReplicaV1,
  terminalMarginalFromJointSamplesV1,
} from "@/lib/trader/research/challengers/rv-state-conditional-challenger-v1";
import type { SourceAnchor } from "@/lib/trader/intelligence/forecast-v2/rv-state-conditional-empirical-joint-v1";

function anchor(i: number, rv: number, rH: number): SourceAnchor {
  return {
    venue: "htx",
    market: "spot",
    symbol: "BTCUSDT",
    closedBarEpochMs: 1_700_000_000_000 + i * 60_000,
    barContentDigest: createHash("sha256").update(String(i)).digest("hex"),
    realizedVol20m_1m: rv,
    outcome13d: [0, 0, 0, rH, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
}

describe("DEE-535 rv-state-conditional-empirical-joint/v1 challenger", () => {
  const familyDigest = createHash("sha256").update("replica-family", "utf8").digest();
  const corpus = Array.from({ length: 90 }, (_, i) =>
    anchor(i, 0.01 + (i % 10) * 0.002, 0.001 * (i % 5)),
  );

  it("registry marks EXECUTOR_READY challenger", () => {
    const registry = challengerModelRegistryV1();
    const ready = registry.find((m) => m.status === CHALLENGER_EXECUTOR_READY_STATUS);
    expect(ready?.modelTransformVersion).toBe("rv-state-conditional-empirical-joint/v1");
  });

  it("state assignment boundary rules", () => {
    expect(assignRvStateTertileV1(0.01, 0.02, 0.03)).toBe("S0");
    expect(assignRvStateTertileV1(0.02, 0.02, 0.03)).toBe("S0");
    expect(assignRvStateTertileV1(0.025, 0.02, 0.03)).toBe("S1");
    expect(assignRvStateTertileV1(0.04, 0.02, 0.03)).toBe("S2");
  });

  it("bootstrap refit produces replica-specific tertile edges", () => {
    const r0 = fitRvStateConditionalReplicaV1({
      sourceCorpus: corpus,
      replicaRootFamilyIdentityDigest: familyDigest,
      replicaOrdinal: 0,
    });
    const r1 = fitRvStateConditionalReplicaV1({
      sourceCorpus: corpus,
      replicaRootFamilyIdentityDigest: familyDigest,
      replicaOrdinal: 1,
    });
    expect(r0.q1).toBeLessThan(r0.q2);
    expect(r1.q1).toBeLessThan(r1.q2);
  });

  it("terminal marginal equals R_h marginal of joint samples", () => {
    const fit = fitRvStateConditionalReplicaV1({
      sourceCorpus: corpus,
      replicaRootFamilyIdentityDigest: familyDigest,
      replicaOrdinal: 0,
    });
    const pool = [...fit.pools.S0, ...fit.pools.S1, ...fit.pools.S2];
    const marginal = terminalMarginalFromJointSamplesV1(pool);
    assertTerminalMarginalCoherenceV1({ jointSamples: pool, terminalBucketMasses: marginal });
  });

  it("rejects duplicate SOURCE anchors", () => {
    const dup = [corpus[0]!, { ...corpus[0]! }];
    expect(() => assertSourceCorpusUnique(dup)).toThrow();
  });
});
