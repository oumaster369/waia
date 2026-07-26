import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AtomicFileWriteError,
  writeFileAtomicExclusive,
} from "@/lib/trader/backtest/streaming-evidence/atomic-file-write";

describe("writeFileAtomicExclusive (DEE-436 E-02)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("rejects sequential overwrite without changing existing bytes", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-exclusive-"));
    const target = join(root, "proof.json");
    writeFileAtomicExclusive(target, '{"a":1}\n');
    const before = readFileSync(target, "utf8");
    const mtimeBefore = statSync(target).mtimeMs;
    expect(() => writeFileAtomicExclusive(target, '{"b":2}\n')).toThrow(AtomicFileWriteError);
    expect(readFileSync(target, "utf8")).toBe(before);
    expect(statSync(target).mtimeMs).toBe(mtimeBefore);
  });

  it("concurrent writer B fails closed while writer A bytes remain", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-exclusive-race-"));
    const target = join(root, "race.json");
    writeFileAtomicExclusive(target, "BYTES_A");
    expect(() => writeFileAtomicExclusive(target, "BYTES_B")).toThrow(AtomicFileWriteError);
    expect(readFileSync(target, "utf8")).toBe("BYTES_A");
    expect(existsSync(target)).toBe(true);
  });
});
