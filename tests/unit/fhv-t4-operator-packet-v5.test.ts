import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FHV_T4A_OPERATOR_STEPS } from "@/lib/trader/observability/fhv-t4a-operator-contract";

const ROOT = process.cwd();
const PACKET = join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md");
const HOST_PROBE = join(ROOT, "scripts/ops/fhv-t4-host-probe.sh");

import { FHV_T4A_CEREMONY_REQUIRED_RESULTS } from "@/lib/trader/observability/fhv-t4a-ceremony-results";

const REQUIRED_CEREMONY_FIELDS = Object.entries(FHV_T4A_CEREMONY_REQUIRED_RESULTS).map(
  ([key, value]) => `${key}=${value}`,
);

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
    expect(
      FHV_T4A_OPERATOR_STEPS.some(
        (step) =>
          step.commandOwner.kind === "package" &&
          step.commandOwner.command === "trader:fhv:t4:verify-ceremony",
      ),
    ).toBe(true);
    expect(body).toContain("fhv-t4-service-user-exec.sh");
    expect(body).toContain("hostMonotonicSample");
    expect(body).toContain("fhv-t4-campaign-wait-completed.sh");
    expect(body).not.toMatch(/fhv-t4-host-monotonic-read\.sh["']/);
  });

  it("passes bash syntax check for fhv-t4-host-probe.sh", () => {
    execFileSync("bash", ["-n", HOST_PROBE], { stdio: "pipe" });
  });

  it("validates every bash block and authorization ordering semantics", () => {
    const body = readFileSync(PACKET, "utf8");
    const executable = body.split("## NON_EXECUTABLE")[0] ?? body;
    const blocks = extractBashBlocks(executable);
    expect(blocks.length).toBeGreaterThan(1);
    for (const block of blocks) {
      execFileSync("bash", ["-n", "-c", block], { stdio: "pipe" });
      expect(block).not.toMatch(/\|\|\s*true/);
    }
    expect(executable).toContain("fhv-t4a-operator.sh");
    expect(executable).toContain("verify-local-release");
    expect(executable).toContain("pre-auth");
    expect(executable).toContain("post-auth-before-disconnect");
    expect(executable).toContain("post-reconnect-finalize");
    const preAuthIndex = executable.indexOf("PRE_AUTHORIZED_READ_ONLY_PHASE");
    const authGateIndex = executable.indexOf("## STOP — `AUTHORIZE-FHV-OPS-DEPLOY`");
    const postAuthIndex = executable.indexOf("POST_AUTHORIZED_T4A_PHASE");
    expect(preAuthIndex).toBeGreaterThan(-1);
    expect(authGateIndex).toBeGreaterThan(preAuthIndex);
    expect(postAuthIndex).toBeGreaterThan(authGateIndex);
    expect(executable.indexOf("resume-campaign-root.sh")).toBeGreaterThan(postAuthIndex);
    expect(executable).toContain("capture-continuity-before");
    expect(executable).toContain("post-reconnect-finalize");
    expect(executable).toContain("unset FHV_T4A_AUTHORIZATION");
    expect(body).toContain("globally unique `FHV_RUN_ID`");
    expect(body).toContain("PR #431");
    expect(body).toContain("AWAITING_HUMAN_DISCONNECT_RECONNECT");
    expect(body).toContain("FHV_T4A_POST_RECONNECT_FINALIZE_OK");
    expect(body).toContain("presence alone is insufficient");
  });
});
