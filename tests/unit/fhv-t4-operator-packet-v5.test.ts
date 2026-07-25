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

function extractBashBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

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

  it("references continuity capture scripts and service-user wrapper", () => {
    const body = readFileSync(PACKET, "utf8");
    expect(body).toContain("trader:fhv:t4:capture-continuity-before");
    expect(body).toContain("trader:fhv:t4:capture-continuity-after");
    expect(body).toContain("trader:fhv:t4:verify-continuity");
    expect(body).toContain("fhv-t4-service-user-exec.sh");
    expect(body).toContain("fhv-t4-host-monotonic-read.sh");
  });

  it("passes bash syntax check for fhv-t4-host-probe.sh", () => {
    execFileSync("bash", ["-n", HOST_PROBE], { stdio: "pipe" });
  });

  it("validates every bash block and authorization ordering semantics", () => {
    const body = readFileSync(PACKET, "utf8");
    const blocks = extractBashBlocks(body);
    expect(blocks.length).toBeGreaterThan(5);
    for (const block of blocks) {
      execFileSync("bash", ["-n", "-c", block], { stdio: "pipe" });
      expect(block).not.toMatch(/\|\|\s*true/);
    }
    const preAuthIndex = body.indexOf("PRE_AUTHORIZED_READ_ONLY_PHASE");
    const authGateIndex = body.indexOf("### STOP — `AUTHORIZE-FHV-OPS-DEPLOY`");
    const postAuthIndex = body.indexOf("POST_AUTHORIZED_T4A_PHASE");
    const pauseArmIndex = body.indexOf("trader:fhv:t4:arm-pause");
    const campaignStartIndex = body.indexOf("systemctl start waia-fhv-campaign.service");
    const sealIndex = body.lastIndexOf("trader:fhv:t4:seal-evidence");
    const rollbackVerifyIndex = body.indexOf("trader:fhv:t4:verify-rollback");
    expect(preAuthIndex).toBeGreaterThan(-1);
    expect(authGateIndex).toBeGreaterThan(preAuthIndex);
    expect(postAuthIndex).toBeGreaterThan(authGateIndex);
    const observerStartIndex = body.indexOf("systemctl start waia-fhv-observer.service");
    const verifyPreArmIndex = body.indexOf("trader:fhv:t4:verify \\\n  --run-root");
    expect(observerStartIndex).toBeGreaterThan(postAuthIndex);
    expect(pauseArmIndex).toBeGreaterThan(observerStartIndex);
    expect(verifyPreArmIndex).toBeGreaterThan(pauseArmIndex);
    expect(campaignStartIndex).toBeGreaterThan(verifyPreArmIndex);
    expect(rollbackVerifyIndex).toBeGreaterThan(campaignStartIndex);
    expect(sealIndex).toBeGreaterThan(rollbackVerifyIndex);
  });
});
