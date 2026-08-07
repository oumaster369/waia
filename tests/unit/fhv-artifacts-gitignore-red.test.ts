/**
 * Phase 9 — artifact hygiene: .artifacts/ must be gitignored.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("FHV artifact hygiene (Phase 9)", () => {
  it("FHV_ARTIFACTS_GITIGNORE: .gitignore contains .artifacts/", () => {
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.artifacts\/$/m);
  });
});
