import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { computeA3AggregateReceipt } from "@/lib/trader/intelligence/forecast-v2/a3-storage-aggregate-v1";
import {
  a3ReceiptPath,
  readA3ReceiptFile,
  validateA3Phase01Receipt,
  writeA3ReceiptAtomic,
  type A3Phase01ReceiptV1,
} from "@/lib/trader/intelligence/forecast-v2/a3-storage-receipt-v1";
import {
  a3TestIdentity,
  sampleA3Phase01,
  sampleA3Phase02,
  sampleA3Phase03,
  sampleA3Provenance,
} from "./a3-storage-test-fixtures-v1";

describe("A3 phased receipt validators", () => {
  it("rejects corrupt receipt digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "a3-receipt-test-"));
    try {
      const receipt = writeA3ReceiptAtomic(dir, "phase-01.json", sampleA3Phase01());
      const path = a3ReceiptPath(dir, "phase-01.json");
      const raw = readFileSync(path, "utf8").replace(
        `"b0Bytes": ${receipt.b0Bytes}`,
        `"b0Bytes": ${receipt.b0Bytes + 1}`,
      );
      writeFileSync(path, raw);
      expect(() => readA3ReceiptFile(path)).toThrow(/corrupt receipt digest/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects missing receipt file", () => {
    expect(() => readA3ReceiptFile(join(tmpdir(), "missing-phase-01.json"))).toThrow(
      /missing receipt/,
    );
  });

  it("aggregate fails closed on canonical contract digest mismatch", () => {
    const aggregate = computeA3AggregateReceipt({
      identity: a3TestIdentity,
      provenance: sampleA3Provenance(),
      phase01: sampleA3Phase01(),
      phase02: sampleA3Phase02({ a3CanonicalContractDigest: "b".repeat(64) }),
      phase03: sampleA3Phase03(),
    });
    expect(aggregate.pass).toBe(false);
  });

  it("aggregate fails closed on observed package surface digest mismatch", () => {
    const aggregate = computeA3AggregateReceipt({
      identity: a3TestIdentity,
      provenance: sampleA3Provenance(),
      phase01: sampleA3Phase01(),
      phase02: sampleA3Phase02({ observedPackageSurfaceDigestHex: "c".repeat(64) }),
      phase03: sampleA3Phase03(),
    });
    expect(aggregate.pass).toBe(false);
    expect(
      aggregate.failureReasons.some((reason) =>
        reason.includes("observed package surface digest mismatch"),
      ),
    ).toBe(true);
  });

  it("writes and validates phase-01 receipt round-trip", () => {
    const dir = mkdtempSync(join(tmpdir(), "a3-receipt-test-"));
    try {
      const written = writeA3ReceiptAtomic(dir, "phase-01.json", sampleA3Phase01());
      const loaded = readA3ReceiptFile<A3Phase01ReceiptV1>(a3ReceiptPath(dir, "phase-01.json"));
      validateA3Phase01Receipt(loaded, a3TestIdentity);
      expect(loaded.receiptContentDigestHex).toBe(written.receiptContentDigestHex);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
