import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildFhvT4MandatoryEvidenceInventory } from "@/lib/trader/observability/fhv-t4-mandatory-evidence-inventory";

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

describe("fhv-t4 mandatory evidence inventory (DEE-436)", () => {
  it("requires host-probe proof and rejects missing mandatory entries", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-inv-missing-"));
    const runRoot = join(root, "run");
    mkdirSync(join(runRoot, "control"), { recursive: true });
    expect(() =>
      buildFhvT4MandatoryEvidenceInventory({
        runRoot,
        repoRoot: root,
        renderedUnitsDir: join(root, "rendered"),
        continuityBeforePath: join(runRoot, "control/before.json"),
        continuityAfterPath: join(runRoot, "control/after.json"),
        hostProbeJsonPath: join(runRoot, "control/fhv-t4-host-probe-proof.v1.json"),
      }),
    ).toThrow(/missing|Mandatory/i);
  });

  it("rejects path escape and symlink escape outside approved roots", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-inv-escape-"));
    const runRoot = join(root, "run");
    const outside = join(root, "outside.json");
    mkdirSync(join(runRoot, "control"), { recursive: true });
    writeFileSync(outside, "{}\n");
    writeFileSync(join(runRoot, "control/fhv-t4-host-probe-proof.v1.json"), "{}\n");
    // Point continuity-before at a path outside run-root namespaces via symlink
    symlinkSync(outside, join(runRoot, "control/before.json"));
    expect(() =>
      buildFhvT4MandatoryEvidenceInventory({
        runRoot,
        repoRoot: root,
        renderedUnitsDir: join(root, "rendered"),
        continuityBeforePath: join(runRoot, "control/before.json"),
        continuityAfterPath: join(runRoot, "control/after.json"),
        hostProbeJsonPath: join(runRoot, "control/fhv-t4-host-probe-proof.v1.json"),
      }),
    ).toThrow(/ESCAPE|missing|Mandatory|realpath|NOT_FILE|SYMLINK/i);
  });

  it("rejects host-probe path that is not the normalized proof path", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-inv-host-"));
    const runRoot = join(root, "run");
    mkdirSync(join(runRoot, "control"), { recursive: true });
    const wrong = join(runRoot, "control/other-probe.json");
    writeFileSync(wrong, "{}\n");
    expect(() =>
      buildFhvT4MandatoryEvidenceInventory({
        runRoot,
        repoRoot: root,
        renderedUnitsDir: join(root, "rendered"),
        continuityBeforePath: join(runRoot, "control/before.json"),
        continuityAfterPath: join(runRoot, "control/after.json"),
        hostProbeJsonPath: wrong,
      }),
    ).toThrow(/host-probe|HOST_PROBE|mismatch|required|missing/i);
  });
});
