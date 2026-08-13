import { createHash } from "node:crypto";

/**
 * Storage-only worst-case replica payload generator (A3 PHASE-02 / package surface).
 * Independent of Forecast scientific CBRNG. Deterministic SHA-256 counter expansion.
 */
export const A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_FIXTURE_VERSION =
  "a3-incompressible-replica-payload/v1" as const;

export const A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_BYTES = 65_536 as const;

export type A3IncompressibleReplicaPayloadIdentityV1 = {
  symbol: string;
  primaryHorizonMinutes: number;
  replicaOrdinal: number;
};

function utf8(value: string): Buffer {
  return Buffer.from(value, "utf8");
}

function u32be(value: number): Buffer {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`[a3-incompressible-fixture] u32 out of range: ${value}`);
  }
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value);
  return buf;
}

/**
 * Exact block serialization (byte-stable):
 *   SHA-256(
 *     utf8(fixture-version) || 0x00 ||
 *     utf8(symbol) || 0x00 ||
 *     u32be(primaryHorizonMinutes) ||
 *     u32be(replicaOrdinal) ||
 *     u32be(blockIndex)
 *   )
 */
export function a3IncompressibleReplicaPayloadBlockV1(
  identity: A3IncompressibleReplicaPayloadIdentityV1,
  blockIndex: number,
): Buffer {
  if (!Number.isInteger(blockIndex) || blockIndex < 0) {
    throw new Error(`[a3-incompressible-fixture] invalid blockIndex=${blockIndex}`);
  }
  return createHash("sha256")
    .update(utf8(A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_FIXTURE_VERSION))
    .update(Buffer.from([0]))
    .update(utf8(identity.symbol))
    .update(Buffer.from([0]))
    .update(u32be(identity.primaryHorizonMinutes))
    .update(u32be(identity.replicaOrdinal))
    .update(u32be(blockIndex))
    .digest();
}

export function buildA3IncompressibleReplicaPayloadV1(
  identity: A3IncompressibleReplicaPayloadIdentityV1,
): Buffer {
  if (!Number.isInteger(identity.replicaOrdinal) || identity.replicaOrdinal < 0) {
    throw new Error(
      `[a3-incompressible-fixture] invalid replicaOrdinal=${identity.replicaOrdinal}`,
    );
  }
  if (!Number.isInteger(identity.primaryHorizonMinutes) || identity.primaryHorizonMinutes <= 0) {
    throw new Error(
      `[a3-incompressible-fixture] invalid primaryHorizonMinutes=${identity.primaryHorizonMinutes}`,
    );
  }
  const out = Buffer.alloc(A3_INCOMPRESSIBLE_REPLICA_PAYLOAD_BYTES);
  let offset = 0;
  let blockIndex = 0;
  while (offset < out.length) {
    const block = a3IncompressibleReplicaPayloadBlockV1(identity, blockIndex);
    const take = Math.min(block.length, out.length - offset);
    block.copy(out, offset, 0, take);
    offset += take;
    blockIndex += 1;
  }
  return out;
}

export function a3IncompressibleReplicaPayloadDigestHexV1(
  identity: A3IncompressibleReplicaPayloadIdentityV1,
): string {
  return createHash("sha256").update(buildA3IncompressibleReplicaPayloadV1(identity)).digest("hex");
}
