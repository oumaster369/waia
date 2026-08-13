import { describe, expect, it } from "vitest";

import {
  CbrngModuloRejectionError,
  CbrngRetryOverflowError,
  epiBootAddress,
  unbiasedIntFromBlock,
  waiaRandomBlockV1,
  waiaUnbiasedInt,
} from "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";

describe("CBRNG rejection taxonomy A10", () => {
  it("fails immediately for N<=0", () => {
    const root = Buffer.alloc(32, 1);
    expect(() => waiaUnbiasedInt(epiBootAddress(root, 0, 0, 0), 0)).toThrow();
    expect(() =>
      unbiasedIntFromBlock(waiaRandomBlockV1(epiBootAddress(root, 0, 0, 0)), 0),
    ).toThrow();
  });

  it("fails immediately for bad root/domain", () => {
    expect(() =>
      waiaUnbiasedInt(
        {
          domain: "BAD",
          rootSeed: Buffer.alloc(32, 1),
          replicaU32: 0,
          sampleU32: 0,
          drawU32: 0,
          retryU32: 0,
        },
        3,
      ),
    ).toThrow();
  });

  it("only modulo rejection is retryable and deterministic on success", () => {
    const block = Buffer.alloc(32, 0xff);
    expect(() => unbiasedIntFromBlock(block, 3)).toThrow(CbrngModuloRejectionError);
    const root = Buffer.alloc(32, 0x42);
    const first = waiaUnbiasedInt(epiBootAddress(root, 1, 2, 3), 5);
    const second = waiaUnbiasedInt(epiBootAddress(root, 1, 2, 3), 5);
    expect(first).toBe(second);
  });

  it("retry overflow fails closed", () => {
    expect(() =>
      waiaUnbiasedInt(
        {
          ...epiBootAddress(Buffer.alloc(32, 1), 0, 0, 0),
          retryU32: 0xffff_ffff,
        },
        3,
      ),
    ).toThrow(CbrngRetryOverflowError);
  });
});
