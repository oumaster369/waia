import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const VALIDATOR = join(ROOT, "scripts/ops/validate-fhv-release-identity.sh");
const REHEARSAL = join(ROOT, "docs/ops/FHV-EXECUTION-SERVER-REHEARSAL-CONTRACT.md");
const PREVIOUS_RELEASE = "1744301f6ed31c754b183634daa37372a7d898cb";

describe("FHV release identity regression (DEE-431)", () => {
  it("passes validate-fhv-release-identity.sh on current ops docs", () => {
    const output = execFileSync("bash", [VALIDATOR], { encoding: "utf8" });
    expect(output).toContain("all checks passed");
  });

  it("rejects active rehearsal instructions with literal previous-release target-sha", () => {
    const body = readFileSync(REHEARSAL, "utf8");
    const active = body.split("## Historical evidence")[0] ?? body;
    expect(active).not.toMatch(new RegExp(`--target-sha ${PREVIOUS_RELEASE}`));
    expect(active).toContain('--target-sha "$EXECUTION_SERVER_TARGET_SHA"');
  });

  it("preserves previous release SHA only in historical evidence section", () => {
    const body = readFileSync(REHEARSAL, "utf8");
    expect(body).toContain(PREVIOUS_RELEASE);
    expect(body).toContain("## Historical evidence");
  });
});
