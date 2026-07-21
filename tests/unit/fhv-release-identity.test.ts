import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import { validateFhvReleaseIdentityMarkdown } from "@/lib/trader/observability/fhv-release-identity-validator";

const ROOT = process.cwd();
const VALIDATOR = join(ROOT, "scripts/ops/validate-fhv-release-identity.sh");
const REHEARSAL = join(ROOT, "docs/ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md");
const PREVIOUS_RELEASE = "1744301f6ed31c754b183634daa37372a7d898cb";

describe("FHV release identity regression (DEE-431)", () => {
  it("passes validate-fhv-release-identity.sh on current ops docs", () => {
    const output = execFileSync("bash", [VALIDATOR], { encoding: "utf8" });
    expect(output).toContain("all checks passed");
  });

  it("rejects fixture documents with literal operational SHAs", () => {
    const dir = mkdtempSync(join(tmpdir(), "fhv-release-id-fixture-"));
    try {
      const bad = `# Ops\nRun: pnpm trader:fhv:rehearsal -- --target-sha ${PREVIOUS_RELEASE}\n`;
      const badPath = join(dir, "bad.md");
      writeFileSync(badPath, bad);
      expect(validateFhvReleaseIdentityMarkdown(bad).ok).toBe(false);
      let failed = false;
      try {
        execFileSync("bash", [VALIDATOR, badPath], { encoding: "utf8", stdio: "pipe" });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves previous release SHA only in historical evidence section", () => {
    const body = readFileSync(REHEARSAL, "utf8");
    expect(body).toContain(PREVIOUS_RELEASE);
    expect(body).toContain("## Historical evidence");
    const active = body.split("## Historical evidence")[0] ?? body;
    expect(active).not.toContain(PREVIOUS_RELEASE);
    expect(active).toContain("$EXECUTION_SERVER_TARGET_SHA");
  });
});
