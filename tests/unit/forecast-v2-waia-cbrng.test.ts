import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ALEATORIC_ROOT_PREFIX_HEX,
  BOOTSTRAP_ROOT_PREFIX_HEX,
  CBRNG_DOMAIN_EPIBOOT1,
  SCORE_ROOT_PREFIX_HEX,
  VALIDATION_BOOTSTRAP_ROOT_PREFIX_HEX,
  WAIA_CBRNG_MAGIC,
} from "@/lib/trader/intelligence/forecast-v2/constants";
import {
  buildWaiaRandomBlockPreimage,
  deriveBootstrapRootK,
  epiBootAddress,
  SAMPLER_CONTRACT_VERSION,
  waiaRandomBlockV1,
  waiaUnbiasedInt,
} from "@/lib/trader/intelligence/forecast-v2/waia-cbrng-v1";

describe("WAIA_RANDOM_BLOCK_V1 / waia-cbrng/sha256-ctr/v1", () => {
  it("exports sampler contract version", () => {
    expect(SAMPLER_CONTRACT_VERSION).toBe("waia-cbrng/sha256-ctr/v1");
  });

  it("uses frozen 8-byte MAGIC and 64-byte preimage layout", () => {
    const root = Buffer.alloc(32, 0xab);
    const preimage = buildWaiaRandomBlockPreimage(epiBootAddress(root, 7, 11, 1, 2));
    expect(preimage.length).toBe(64);
    expect(preimage.subarray(0, 8).toString("ascii")).toBe(WAIA_CBRNG_MAGIC);
    expect(preimage.subarray(8, 16).toString("ascii")).toBe(CBRNG_DOMAIN_EPIBOOT1);
    expect(preimage.subarray(16, 48)).toEqual(root);
    expect(preimage.readUInt32BE(48)).toBe(7);
    expect(preimage.readUInt32BE(52)).toBe(11);
    expect(preimage.readUInt32BE(56)).toBe(1);
    expect(preimage.readUInt32BE(60)).toBe(2);
  });

  it("asserts frozen 16-byte root prefix bytes (C1)", () => {
    expect(Buffer.from("WAIAEPIBOOTROOT1", "ascii").toString("hex")).toBe(
      BOOTSTRAP_ROOT_PREFIX_HEX,
    );
    expect(Buffer.from("WAIAALEDRAWROOT1", "ascii").toString("hex")).toBe(
      ALEATORIC_ROOT_PREFIX_HEX,
    );
    expect(Buffer.from("WAIASCOREROOT001", "ascii").toString("hex")).toBe(SCORE_ROOT_PREFIX_HEX);
    expect(Buffer.from("WAIAVALBOOTROOT1", "ascii").toString("hex")).toBe(
      VALIDATION_BOOTSTRAP_ROOT_PREFIX_HEX,
    );
  });

  it("has known-answer block hash for zeroed EPIBOOT1 address", () => {
    const address = epiBootAddress(Buffer.alloc(32, 0), 0, 0, 0, 0);
    const block = waiaRandomBlockV1(address);
    expect(block.toString("hex")).toBe(
      "3383572cd6560f8d34ffd0fabdee32e88f4b13a11d55b8d4ecaf8daa1065baa0",
    );
    expect(createHash("sha256").update(buildWaiaRandomBlockPreimage(address)).digest("hex")).toBe(
      block.toString("hex"),
    );
    expect(waiaRandomBlockV1(address).equals(block)).toBe(true);
    expect(block.length).toBe(32);
  });

  it("derives bootstrap_root_k from prefix ‖ family digest ‖ uint32_be(k)", () => {
    const family = Buffer.alloc(32, 0xab);
    const rootK0 = deriveBootstrapRootK(family, 0);
    const rootK1 = deriveBootstrapRootK(family, 1);
    expect(rootK0.length).toBe(32);
    expect(rootK1.length).toBe(32);
    expect(rootK0.equals(rootK1)).toBe(false);

    const manual = createHash("sha256")
      .update(Buffer.from("WAIAEPIBOOTROOT1", "ascii"))
      .update(family)
      .update(Buffer.from([0, 0, 0, 1]))
      .digest();
    expect(deriveBootstrapRootK(family, 1).equals(manual)).toBe(true);
  });

  it("draws unbiased integers with rejection retries", () => {
    const root = createHash("sha256").update("forecast-v2/cbrng-test-root", "utf8").digest();
    const value = waiaUnbiasedInt(epiBootAddress(root, 3, 9, 0), 8);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(8);
  });
});
