import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { copyAndDigestSync } from "@/lib/trader/observability/fhv-checkpoint-cost-model";
import {
  probeFhvNativeCloneCapability,
  tryNativeCloneFile,
} from "@/lib/trader/observability/fhv-native-clone";

/**
 * WP-3B Option E. The blocking gate is only sound if the clone path and the fused copy+digest
 * fallback are byte-for-byte interchangeable, and if a clone is a genuinely independent file
 * rather than an alias that a later write to the source could corrupt.
 */

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "fhv-clone-equiv-"));
  roots.push(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe("FHV native clone", () => {
  it("produces bytes and a digest identical to the copy fallback", () => {
    const root = makeRoot();
    const source = join(root, "session.sqlite");
    writeFileSync(source, randomBytes(3_145_728));
    const sourceDigest = createHash("sha256").update(readFileSync(source)).digest("hex");

    const clonePath = join(root, "clone.sqlite");
    const clone = tryNativeCloneFile(source, clonePath);
    const fallbackPath = join(root, "fallback.sqlite");
    const fallback = copyAndDigestSync(source, fallbackPath);

    expect(fallback.digest).toBe(sourceDigest);

    if (clone.status !== "NATIVE_CLONE_SUCCEEDED") {
      // A non-reflink host is a truthful, non-blocking portability outcome, never a silent pass.
      expect(clone.reflinkUsed).toBe(false);
      expect(clone.status).toBe("NATIVE_CLONE_UNSUPPORTED");
      return;
    }

    expect(clone.reflinkUsed).toBe(true);
    expect(readFileSync(clonePath).equals(readFileSync(fallbackPath))).toBe(true);
    expect(createHash("sha256").update(readFileSync(clonePath)).digest("hex")).toBe(sourceDigest);
    expect(statSync(clonePath).size).toBe(statSync(source).size);
  });

  it("isolates the clone from later writes to the source", () => {
    const root = makeRoot();
    const source = join(root, "session.sqlite");
    const original = randomBytes(1_048_576);
    writeFileSync(source, original);

    const clonePath = join(root, "clone.sqlite");
    const clone = tryNativeCloneFile(source, clonePath);
    if (clone.status !== "NATIVE_CLONE_SUCCEEDED") return;

    // Copy-on-write must break the shared extents, not propagate the mutation into the snapshot.
    writeFileSync(source, randomBytes(1_048_576));
    expect(readFileSync(clonePath).equals(original)).toBe(true);
    expect(readFileSync(source).equals(original)).toBe(false);
  });

  it("never reports clone success without an independently verified destination", () => {
    const root = makeRoot();
    const missing = join(root, "absent.sqlite");
    const result = tryNativeCloneFile(missing, join(root, "out.sqlite"));

    expect(result.status).not.toBe("NATIVE_CLONE_SUCCEEDED");
    expect(result.reflinkUsed).toBe(false);
  });

  it("classifies host capability without inferring it from the platform name", () => {
    const root = makeRoot();
    const capability = probeFhvNativeCloneCapability({
      directory: root,
      writeProbe: (path) => writeFileSync(path, randomBytes(4096)),
    });

    expect(capability.supported).toBe(capability.status === "NATIVE_CLONE_SUCCEEDED");
    expect(capability.mechanism.length).toBeGreaterThan(0);
    expect(capability.platform).toContain(process.platform);
  });
});
