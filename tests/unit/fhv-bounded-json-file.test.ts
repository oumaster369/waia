import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computePayloadDigest } from "@/lib/trader/backtest/streaming-evidence/streaming-evidence-manifest";
import { readJsonFileBoundedSync } from "@/lib/trader/market-data/bounded-json-file";
import { setFhvBlindHoldoutAccessTrapForTests } from "@/lib/trader/market-data/fhv-blind-holdout-firewall";
import { readFhvPreHoldoutQualificationReceipt } from "@/lib/trader/market-data/fhv-pre-holdout-qualification";
import { readFhvPreHoldoutRuntimeRequalification } from "@/lib/trader/market-data/fhv-pre-holdout-runtime-requalification";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "waia-bounded-receipt-"));
});
afterEach(() => {
  setFhvBlindHoldoutAccessTrapForTests(null);
  rmSync(root, { recursive: true, force: true });
});

describe("bounded receipt JSON file reads", () => {
  it("accepts the exact byte limit, not the character count, and preserves the no-limit default", () => {
    const path = join(root, "receipt.json");
    const value = { name: "é", padding: "a".repeat(80) };
    const raw = JSON.stringify(value);
    const bytes = Buffer.byteLength(raw);
    writeFileSync(path, raw);

    expect(readJsonFileBoundedSync(path, { maxBytes: bytes })).toEqual(value);
    expect(() => readJsonFileBoundedSync(path, { maxBytes: bytes - 1 })).toThrow(
      /JSON_FILE_TOO_LARGE/,
    );
    expect(readJsonFileBoundedSync(path)).toEqual(value);
  });

  it("refuses invalid limits, malformed JSON, directories and symlinks", () => {
    const path = join(root, "malformed.json");
    writeFileSync(path, "{");
    expect(() => readJsonFileBoundedSync(path, { maxBytes: 0 })).toThrow(
      /JSON_FILE_BYTE_LIMIT_INVALID/,
    );
    expect(() => readJsonFileBoundedSync(path, { maxBytes: Number.NaN })).toThrow(
      /JSON_FILE_BYTE_LIMIT_INVALID/,
    );
    expect(() => readJsonFileBoundedSync(path, { maxBytes: 1 })).toThrow(SyntaxError);

    const directory = join(root, "directory");
    mkdirSync(directory);
    expect(() => readJsonFileBoundedSync(directory, { maxBytes: 100 })).toThrow(
      /JSON_FILE_NOT_REGULAR/,
    );
    const link = join(root, "linked.json");
    symlinkSync(path, link);
    expect(() => readJsonFileBoundedSync(link, { maxBytes: 100 })).toThrow();
  });

  it("applies the optional byte cap to both existing receipt readers", () => {
    const qualificationPath = join(root, "qualification.json");
    writeFileSync(qualificationPath, "x".repeat(256));
    expect(() => readFhvPreHoldoutQualificationReceipt(
      qualificationPath, { maxReceiptBytes: 255 },
    )).toThrow(/JSON_FILE_TOO_LARGE/);

    const runtimePath = join(root, "runtime.json");
    const body = {
      schemaVersion: "fhv-pre-holdout-runtime-requalification/v1",
      classification: "RUNTIME_REQUALIFICATION=PASS",
      sourceQualificationReceiptDigest: "a".repeat(64),
      sourceReleaseSha: "b".repeat(40),
      targetReleaseSha: "c".repeat(40),
      datasetContentDigest: "d".repeat(64),
      organizationId: "org-test",
      operatorId: "operator-test",
      verifiedAtUtc: "2026-01-01T00:00:00.000Z",
    };
    const receipt = { ...body, requalificationReceiptDigest: computePayloadDigest(body) };
    const raw = JSON.stringify(receipt);
    const bytes = Buffer.byteLength(raw);
    writeFileSync(runtimePath, raw);
    expect(readFhvPreHoldoutRuntimeRequalification(
      runtimePath, { maxReceiptBytes: bytes },
    )).toEqual(receipt);
    expect(() => readFhvPreHoldoutRuntimeRequalification(
      runtimePath, { maxReceiptBytes: bytes - 1 },
    )).toThrow(/JSON_FILE_TOO_LARGE/);
    expect(readFhvPreHoldoutRuntimeRequalification(runtimePath)).toEqual(receipt);
  });

  it("retains the blind-holdout path firewall before opening a receipt", () => {
    const path = join(root, "partitions", "blind-holdout", "BTCUSDT", "bars.json");
    const attempted: string[] = [];
    setFhvBlindHoldoutAccessTrapForTests((value) => attempted.push(value));
    expect(() => readFhvPreHoldoutQualificationReceipt(
      path, { maxReceiptBytes: 100 },
    )).toThrow(/blind-holdout payload access is forbidden/);
    expect(attempted).toEqual([path]);
  });
});
