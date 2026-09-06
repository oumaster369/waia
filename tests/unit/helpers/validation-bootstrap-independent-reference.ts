// Test-only scalar oracle: frozen DEE-518 bytes and transitions, no production RNG/bootstrap imports.
import { createHash } from "node:crypto";

export function independentDraw(input: {
  domain: string; root: Buffer; replica: number; position: number; draw: number; n: number; retry?: number;
}): { value: number; retry: number } {
  const modulus = BigInt(input.n);
  const ceiling = 2n ** 64n - (2n ** 64n % modulus);
  for (let retry = input.retry ?? 0; retry <= 0xffff_ffff; retry += 1) {
    const ordinals = Buffer.alloc(16);
    [input.replica, input.position, input.draw, retry].forEach((ordinal, i) => ordinals.writeUInt32BE(ordinal, i * 4));
    const preimage = Buffer.concat([Buffer.from("WAIACBR1", "ascii"), Buffer.from(input.domain, "ascii"), input.root, ordinals]);
    const block = createHash("sha256").update(preimage).digest();
    const word = BigInt(`0x${block.subarray(0, 8).toString("hex")}`);
    if (word < ceiling) return { value: Number(word % modulus), retry };
  }
  throw new Error("oracle retry overflow");
}

export function independentValidationResample(source: readonly number[], root: Buffer, ordinal: number) {
  const n = source.length;
  let l = 1n;
  while (l ** 3n < BigInt(n)) l += 1n;
  const draw = (position: number, kind: number, modulus: number) => independentDraw({
    domain: "VALBOOT1", root, replica: ordinal, position, draw: kind, n: modulus }).value;
  const indices = [draw(0, 0, n)];
  for (let j = 1; j < n; j += 1) {
    indices.push(draw(j, 1, Number(l)) === 0 ? draw(j, 0, n) : (indices[j - 1]! + 1) % n);
  }
  const resampled = indices.map(i => source[i]!);
  return { indices, resampled, sum: resampled.reduce((sum, v) => sum + v, 0), blockLength: Number(l) };
}

export function independentValidationPValue(source: readonly number[], trialDigest: Buffer) {
  const n = source.length;
  const dBar = source.reduce((sum, v) => sum + v, 0) / n;
  const centered = source.map(v => v - dBar);
  const centeredMean = centered.reduce((sum, v) => sum + v, 0) / n;
  const tObs = Math.sqrt(n) * dBar;
  const root = createHash("sha256").update(Buffer.concat([
    Buffer.from("WAIAVALBOOTROOT1", "ascii"), trialDigest,
  ])).digest();
  let extremeCount = 0;
  for (let b = 0; b < 10_000; b += 1) {
    const tStar = Math.sqrt(n) * (independentValidationResample(centered, root, b).sum / n);
    if (tStar >= tObs) extremeCount += 1;
  }
  return { pRaw: (extremeCount + 1) / 10_001, dBar, tObs, extremeCount, centeredMean, n };
}
