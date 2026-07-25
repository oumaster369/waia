import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseFhvT4CompletedCampaignSystemdIdentity,
  serializeFhvT4CompletedCampaignSystemdIdentity,
} from "@/lib/trader/observability/fhv-t4-completed-campaign-systemd-identity";

const ROOT = process.cwd();
const PACKET = join(ROOT, "docs/ops/T4_OPERATOR_PACKET_V5.md");

let shimRoot = "";

afterEach(() => {
  if (shimRoot) {
    rmSync(shimRoot, { recursive: true, force: true });
    shimRoot = "";
  }
});

function runBash(
  scriptRel: string,
  args: string[] = [],
  env: Record<string, string | undefined> = {},
): number {
  try {
    execFileSync("bash", [join(ROOT, scriptRel), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

describe("fhv-t4 packet simulation (DEE-436)", () => {
  it("documents canonical operator phases and bootstrap contract", () => {
    const body = readFileSync(PACKET, "utf8");
    const executable = body.split("## NON_EXECUTABLE")[0] ?? body;
    const pre = executable.slice(
      executable.indexOf("PRE_AUTHORIZED_READ_ONLY_PHASE"),
      executable.indexOf("POST_AUTHORIZED_T4A_PHASE"),
    );
    expect(pre).toContain("fhv-t4a-operator.sh");
    expect(pre).toContain("pre-auth");
    expect(executable).toContain("git show");
    expect(executable).toContain("fhv-t4-campaign-wait-completed.sh");
    expect(executable).toContain("resume-campaign-root.sh");
    expect(executable.indexOf("post-auth-before-disconnect")).toBeLessThan(
      executable.indexOf("post-reconnect-finalize"),
    );
  });

  it("requires root for service-user checkout and rejects non-root deadlock", () => {
    shimRoot = mkdtempSync(join(tmpdir(), "fhv-packet-shim-"));
    const checkoutParent = join(shimRoot, "parent");
    mkdirSync(checkoutParent, { recursive: true });
    const nonRoot = runBash("scripts/ops/fhv-service-user-checkout.sh", [
      "--service-user",
      process.env.USER || "nobody",
      "--checkout-parent",
      checkoutParent,
      "--checkout-dir",
      "waia-test",
      "--target-sha",
      "a".repeat(40),
      "--release-tag",
      "tag",
      "--git-bin",
      "/usr/bin/git",
      "--python-bin",
      "/usr/bin/python3",
    ]);
    expect(nonRoot).not.toBe(0);
  });

  it("accepts real systemd success semantics for completed campaign identity", () => {
    const identity = serializeFhvT4CompletedCampaignSystemdIdentity({
      schemaVersion: "fhv-t4-completed-campaign-systemd-identity/v1",
      unitName: "waia-fhv-campaign.service",
      bootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      activeState: "inactive",
      subState: "dead",
      result: "success",
      invocationId: "11111111111111111111111111111111",
      execMainPid: 12345,
      execMainStartTimestampMonotonic: "1000000",
      execMainExitTimestampMonotonic: "5000000",
      execMainCode: 1,
      execMainStatus: 0,
      nRestarts: 0,
    });
    expect(parseFhvT4CompletedCampaignSystemdIdentity(identity).execMainCode).toBe(1);
  });

  it("rejects synthetic ExecMainCode=0 fixture", () => {
    const bad = serializeFhvT4CompletedCampaignSystemdIdentity({
      schemaVersion: "fhv-t4-completed-campaign-systemd-identity/v1",
      unitName: "waia-fhv-campaign.service",
      bootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      activeState: "inactive",
      subState: "dead",
      result: "success",
      invocationId: "11111111111111111111111111111111",
      execMainPid: 12345,
      execMainStartTimestampMonotonic: "1000000",
      execMainExitTimestampMonotonic: "5000000",
      execMainCode: 0,
      execMainStatus: 0,
      nRestarts: 0,
    });
    expect(() => parseFhvT4CompletedCampaignSystemdIdentity(bad)).toThrow(/ExecMainCode must be 1/);
  });

  it("render-units.sh uses explicit NODE_BIN for JSON extraction", () => {
    const render = readFileSync(join(ROOT, "scripts/ops/fhv-supervisor/render-units.sh"), "utf8");
    expect(render).toContain('"$NODE_BIN" -e');
    expect(render).not.toMatch(/printf.*\| node -e/);
    expect(render).toContain('WAIA_TRADER_CLI=1 "$NODE_BIN"');
  });

  it("install-units.sh requires --node-bin and passes it to render-units", () => {
    const install = readFileSync(join(ROOT, "scripts/ops/fhv-supervisor/install-units.sh"), "utf8");
    expect(install).toContain("--node-bin");
    expect(install).toContain('[[ -n "$NODE_BIN" ]] || die "--node-bin is required"');
    expect(install).toContain('--node-bin "$NODE_BIN"');
    const missing = runBash("scripts/ops/fhv-supervisor/install-units.sh", [
      "--working-directory",
      "/tmp/waia",
      "--service-user",
      "fhv",
      "--environment-file",
      "/etc/fhv.env",
      "--run-root",
      "/tmp/run",
      "--run-id",
      "run",
      "--organization-id",
      "00000000-0000-4000-8000-000000000001",
      "--target-sha",
      "a".repeat(40),
    ]);
    expect(missing).not.toBe(0);
  });

  it("rejects completed campaign negative systemd fixtures", () => {
    const base = {
      schemaVersion: "fhv-t4-completed-campaign-systemd-identity/v1" as const,
      unitName: "waia-fhv-campaign.service",
      bootId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      subState: "dead",
      invocationId: "11111111111111111111111111111111",
      execMainPid: 12345,
      execMainStartTimestampMonotonic: "1000000",
      execMainExitTimestampMonotonic: "5000000",
      execMainCode: 1,
      execMainStatus: 0,
      nRestarts: 0,
    };
    expect(() =>
      parseFhvT4CompletedCampaignSystemdIdentity(
        serializeFhvT4CompletedCampaignSystemdIdentity({
          ...base,
          activeState: "active",
          result: "success",
        }),
      ),
    ).toThrow(/inactive/i);
    expect(() =>
      parseFhvT4CompletedCampaignSystemdIdentity(
        serializeFhvT4CompletedCampaignSystemdIdentity({
          ...base,
          activeState: "inactive",
          result: "exit-code",
        }),
      ),
    ).toThrow(/success/i);
    expect(() =>
      parseFhvT4CompletedCampaignSystemdIdentity(
        serializeFhvT4CompletedCampaignSystemdIdentity({
          ...base,
          activeState: "inactive",
          result: "success",
          execMainStatus: 1,
        }),
      ),
    ).toThrow(/ExecMainStatus must be 0/i);
    expect(() =>
      parseFhvT4CompletedCampaignSystemdIdentity(
        serializeFhvT4CompletedCampaignSystemdIdentity({
          ...base,
          activeState: "inactive",
          result: "success",
          execMainPid: 0,
        }),
      ),
    ).toThrow(/execMainPid/i);
    expect(() =>
      parseFhvT4CompletedCampaignSystemdIdentity(
        serializeFhvT4CompletedCampaignSystemdIdentity({
          ...base,
          activeState: "inactive",
          result: "success",
          execMainStartTimestampMonotonic: "5000000",
          execMainExitTimestampMonotonic: "1000000",
        }),
      ),
    ).toThrow(/after start/i);
  });

  it("passes bash -n on privilege and bootstrap ops scripts", () => {
    for (const script of [
      "scripts/ops/_fhv-t4-privilege-common.sh",
      "scripts/ops/fhv-service-user-checkout.sh",
      "scripts/ops/fhv-service-user-install-deps.sh",
      "scripts/ops/fhv-t4-campaign-wait-completed.sh",
      "scripts/ops/fhv-t4-host-preflight.sh",
    ]) {
      execFileSync("bash", ["-n", join(ROOT, script)], { stdio: "pipe" });
    }
  });
});
