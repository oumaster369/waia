import { createHash } from "node:crypto";

import {
  BOOTSTRAP_ROOT_PREFIX_16,
  CBRNG_DOMAIN_EPIBOOT1,
  SAMPLER_CONTRACT_VERSION,
  WAIA_CBRNG_MAGIC,
} from "./constants";

export { SAMPLER_CONTRACT_VERSION, WAIA_CBRNG_MAGIC };

export type WaiaCbrngAddress = {
  domain: string;
  rootSeed: Buffer;
  replicaU32: number;
  sampleU32: number;
  drawU32: number;
  retryU32: number;
};

function assertDomainLength(domain: string): void {
  if (Buffer.byteLength(domain, "ascii") !== 8) {
    throw new Error(`[forecast-v2/cbrng] domain must be exactly 8 ASCII bytes: ${domain}`);
  }
}

function assertRootSeed(rootSeed: Buffer): void {
  if (rootSeed.length !== 32) {
    throw new Error(`[forecast-v2/cbrng] root seed must be exactly 32 bytes`);
  }
}

function assertU32(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new Error(`[forecast-v2/cbrng] ${name} must be uint32: ${value}`);
  }
}

export function buildWaiaRandomBlockPreimage(address: WaiaCbrngAddress): Buffer {
  assertDomainLength(address.domain);
  assertRootSeed(address.rootSeed);
  assertU32("replicaU32", address.replicaU32);
  assertU32("sampleU32", address.sampleU32);
  assertU32("drawU32", address.drawU32);
  assertU32("retryU32", address.retryU32);

  const preimage = Buffer.alloc(64);
  preimage.write(WAIA_CBRNG_MAGIC, 0, 8, "ascii");
  preimage.write(address.domain, 8, 8, "ascii");
  address.rootSeed.copy(preimage, 16);
  preimage.writeUInt32BE(address.replicaU32, 48);
  preimage.writeUInt32BE(address.sampleU32, 52);
  preimage.writeUInt32BE(address.drawU32, 56);
  preimage.writeUInt32BE(address.retryU32, 60);
  return preimage;
}

export function waiaRandomBlockV1(address: WaiaCbrngAddress): Buffer {
  return createHash("sha256").update(buildWaiaRandomBlockPreimage(address)).digest();
}

export function unbiasedIntFromBlock(block: Buffer, n: number): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[forecast-v2/cbrng] UNBIASED_INT requires N > 0, got ${n}`);
  }
  if (block.length !== 32) {
    throw new Error("[forecast-v2/cbrng] block must be 32 bytes");
  }

  const bigN = BigInt(n);
  const limit = (1n << 64n) - ((1n << 64n) % bigN);
  const word = block.readBigUInt64BE(0);
  if (word >= limit) {
    throw new Error("[forecast-v2/cbrng] rejection required — increment retry_u32 and redraw");
  }
  return Number(word % bigN);
}

export function waiaUnbiasedInt(address: WaiaCbrngAddress, n: number): number {
  let retry = address.retryU32;
  for (;;) {
    const block = waiaRandomBlockV1({ ...address, retryU32: retry });
    try {
      return unbiasedIntFromBlock(block, n);
    } catch {
      retry += 1;
    }
  }
}

export function uint53UniformFromBlock(block: Buffer): number {
  const word = block.readBigUInt64BE(0);
  const numerator = word >> 11n;
  return Number(numerator) / 2 ** 53;
}

export function deriveBootstrapRootK(
  replicaRootFamilyIdentityDigest: Buffer,
  replicaOrdinal: number,
): Buffer {
  if (replicaRootFamilyIdentityDigest.length !== 32) {
    throw new Error("[forecast-v2/cbrng] replica root family digest must be 32 bytes");
  }
  assertU32("replicaOrdinal", replicaOrdinal);
  return createHash("sha256")
    .update(Buffer.from(BOOTSTRAP_ROOT_PREFIX_16, "ascii"))
    .update(replicaRootFamilyIdentityDigest)
    .update(
      Buffer.from([
        (replicaOrdinal >>> 24) & 0xff,
        (replicaOrdinal >>> 16) & 0xff,
        (replicaOrdinal >>> 8) & 0xff,
        replicaOrdinal & 0xff,
      ]),
    )
    .digest();
}

export function epiBootAddress(
  rootSeed: Buffer,
  replicaU32: number,
  sampleU32: number,
  drawU32: number,
  retryU32 = 0,
): WaiaCbrngAddress {
  return {
    domain: CBRNG_DOMAIN_EPIBOOT1,
    rootSeed,
    replicaU32,
    sampleU32,
    drawU32,
    retryU32,
  };
}
