import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_BYTES,
  A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_FIXTURE_VERSION,
  a3IncompressibleReplicaPayloadBlockV1,
  a3IncompressibleReplicaPayloadDigestHexV1,
  buildA3IncompressibleReplicaPayloadV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-incompressible-replica-payload-v1";

describe("A3 incompressible replica payload fixture", () => {
  it("emits exactly 65536 bytes and is deterministic", () => {
    const a = buildA3IncompressibleReplicaPayloadV1({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
    });
    const b = buildA3IncompressibleReplicaPayloadV1({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
    });
    expect(a.length).toBe(A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_BYTES);
    expect(a.equals(b)).toBe(true);
  });

  it("differs by package cell and replica ordinal", () => {
    const base = buildA3IncompressibleReplicaPayloadV1({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
    });
    const otherSymbol = buildA3IncompressibleReplicaPayloadV1({
      symbol: "ETHUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
    });
    const otherHorizon = buildA3IncompressibleReplicaPayloadV1({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 60,
      replicaOrdinal: 0,
    });
    const otherReplica = buildA3IncompressibleReplicaPayloadV1({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 1,
    });
    expect(base.equals(otherSymbol)).toBe(false);
    expect(base.equals(otherHorizon)).toBe(false);
    expect(base.equals(otherReplica)).toBe(false);
  });

  it("byte-exact KAT for block 0 and content digest", () => {
    const identity = {
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
    };
    const block0 = a3IncompressibleReplicaPayloadBlockV1(identity, 0);
    const expectedBlock0 = createHash("sha256")
      .update(A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_FIXTURE_VERSION, "utf8")
      .update(Buffer.from([0]))
      .update("BTCUSDT", "utf8")
      .update(Buffer.from([0]))
      .update(Buffer.from([0, 0, 0, 30]))
      .update(Buffer.from([0, 0, 0, 0]))
      .update(Buffer.from([0, 0, 0, 0]))
      .digest();
    expect(block0.equals(expectedBlock0)).toBe(true);

    const payload = buildA3IncompressibleReplicaPayloadV1(identity);
    expect(payload.subarray(0, 32).equals(block0)).toBe(true);
    expect(block0.toString("hex")).toBe(
      "10ab1cd8606107745ef914ab7dde34f866186b3d1727aff2ee35a21e3f2ebffa",
    );
    expect(a3IncompressibleReplicaPayloadDigestHexV1(identity)).toBe(
      "4ebda00fb57c3c86a4672ba60f4b4df16df36b700df16cca56af6084bb94c95c",
    );
    expect(a3IncompressibleReplicaPayloadDigestHexV1(identity)).toBe(
      createHash("sha256").update(payload).digest("hex"),
    );
  });

  it("is not the trivial 0xab fill pattern", () => {
    const payload = buildA3IncompressibleReplicaPayloadV1({
      symbol: "BTCUSDT",
      primaryHorizonMinutes: 30,
      replicaOrdinal: 0,
    });
    const trivial = Buffer.alloc(65536, 0xab);
    expect(payload.equals(trivial)).toBe(false);
    // High unique-byte entropy vs constant fill
    const unique = new Set(payload);
    expect(unique.size).toBeGreaterThan(200);
  });
});
