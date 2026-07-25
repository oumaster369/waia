import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PACKET = join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md");

const SCRIPT_FLAG_ALLOWLIST: Record<string, readonly string[]> = {
  "scripts/ops/fhv-supervisor/render-units.sh": [
    "--target-sha",
    "--repo-path",
    "--working-directory",
    "--service-user",
    "--environment-file",
    "--fhv-run-root",
    "--fhv-run-id",
    "--fhv-organization-id",
    "--output-dir",
    "--node-bin",
    "--observer-port",
    "--dry-run",
  ],
  "scripts/ops/fhv-supervisor/install-units.sh": [
    "--target-sha",
    "--repo-path",
    "--working-directory",
    "--service-user",
    "--environment-file",
    "--fhv-run-root",
    "--fhv-run-id",
    "--fhv-organization-id",
    "--unit",
    "--systemd-dir",
    "--node-bin",
    "--confirm",
    "--dry-run",
  ],
  "scripts/ops/fhv-supervisor/rollback-units.sh": [
    "--unit",
    "--systemd-dir",
    "--confirm",
    "--dry-run",
  ],
  "scripts/ops/fhv-systemd-record-deploy.sh": [
    "--target-sha",
    "--release-tag",
    "--run-id",
    "--organization-id",
    "--operator",
    "--service-user",
    "--rendered-unit-digests",
    "--repo-path",
    "--confirm",
    "--dry-run",
  ],
};

function extractBashBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const regex = /```bash\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    blocks.push(match[1] ?? "");
  }
  return blocks;
}

function extractFlagsFromBlock(block: string): string[] {
  return [...block.matchAll(/\s(--[a-z0-9-]+)/g)].map((match) => match[1]!);
}

describe("T4 operator packet command contract (DEE-436)", () => {
  it("uses only allowlisted flags for supervisor and deploy scripts", () => {
    const body = readFileSync(PACKET, "utf8");
    for (const block of extractBashBlocks(body)) {
      for (const [script, allowed] of Object.entries(SCRIPT_FLAG_ALLOWLIST)) {
        if (!block.includes(script)) {
          continue;
        }
        const scriptLines: string[] = [];
        let capture = false;
        for (const line of block.split("\n")) {
          if (line.includes(script)) {
            capture = true;
          } else if (capture && /scripts\/ops\//.test(line)) {
            break;
          }
          if (capture) {
            scriptLines.push(line);
            if (!line.trimEnd().endsWith("\\")) {
              capture = false;
            }
          }
        }
        const scriptBlock = scriptLines.join("\n");
        if (!scriptBlock.includes(script)) {
          continue;
        }
        for (const flag of extractFlagsFromBlock(scriptBlock)) {
          expect(allowed, `${script} flag ${flag} in block`).toContain(flag);
        }
      }
    }
  });

  it("passes bash -n on every executable packet block", () => {
    const body = readFileSync(PACKET, "utf8");
    for (const [index, block] of extractBashBlocks(body).entries()) {
      execFileSync("bash", ["-n", "-c", block], { stdio: "pipe" });
      expect(block.length, `block ${index}`).toBeGreaterThan(0);
    }
  });

  it("declares bounded wait and inventory builder package commands", () => {
    const body = readFileSync(PACKET, "utf8");
    expect(body).toContain("trader:fhv:t4:wait-paused");
    expect(body).toContain("trader:fhv:t4:wait-final");
    expect(body).toContain("trader:fhv:t4:build-evidence-inventory");
    expect(body).not.toContain("--evidence-list");
    expect(body).toContain("PRE_AUTHORIZED_READ_ONLY_PHASE");
    expect(body).toContain("POST_AUTHORIZED_T4A_PHASE");
    expect(body).toContain("AUTHORIZE-FHV-OPS-DEPLOY");
  });
});
