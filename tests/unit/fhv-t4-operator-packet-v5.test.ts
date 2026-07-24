import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PACKET = join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md");
const HOST_PROBE = join(ROOT, "scripts/ops/fhv-t4-host-probe.sh");

const REQUIRED_CEREMONY_FIELDS = [
  "T4A_RESULT=PASS",
  "GATE8_RESULT=PASS",
  "T4B_RESULT=NOT_EXECUTED_SEPARATE_GATE",
  "CONTINUITY_RESULT=PASS",
] as const;

const FORBIDDEN_CEREMONY_FIELDS = [
  "T4_RESULT=PASS",
  "T4_AGGREGATE_RESULT=PASS",
  "DASHBOARD_RESULT=PASS",
] as const;

describe("T4 operator packet V5 (DEE-436)", () => {
  it("documents Model C ceremony fields and forbids legacy aggregate PASS", () => {
    const body = readFileSync(PACKET, "utf8");
    for (const field of REQUIRED_CEREMONY_FIELDS) {
      expect(body).toContain(field);
    }
    const activeLines = body.split("\n").filter((line) => !/do\s+\*\*not\*\* use/i.test(line));
    for (const field of FORBIDDEN_CEREMONY_FIELDS) {
      expect(activeLines.some((line) => line.includes(field))).toBe(false);
    }
    expect(body).toContain("AUTHORIZE-T4A-T4B-CONTRACT-SPLIT");
    expect(body).toContain("gate8_satisfied_by=T4A_ONLY");
  });

  it("references continuity capture scripts", () => {
    const body = readFileSync(PACKET, "utf8");
    expect(body).toContain("trader:fhv:t4:capture-continuity-before");
    expect(body).toContain("trader:fhv:t4:capture-continuity-after");
    expect(body).toContain("trader:fhv:t4:verify-continuity");
  });

  it("passes bash syntax check for fhv-t4-host-probe.sh", () => {
    execFileSync("bash", ["-n", HOST_PROBE], { stdio: "pipe" });
  });
});
