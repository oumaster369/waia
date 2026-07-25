import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function runRollback(args: string[], mockBin: string): { status: number; stderr: string } {
  const script = join(process.cwd(), "scripts/ops/fhv-supervisor/rollback-units.sh");
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${mockBin}:${process.env.PATH ?? ""}` },
  });
  return { status: result.status ?? 1, stderr: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function writeMockBin(): string {
  const mockBin = mkdtempSync(join(tmpdir(), "fhv-rollback-mock-"));
  writeFileSync(
    join(mockBin, "systemctl"),
    `#!/usr/bin/env bash
case "$1" in
  is-active) echo inactive; exit 3 ;;
  is-enabled) echo disabled; exit 1 ;;
  stop|disable|daemon-reload) exit 0 ;;
  *) exit 0 ;;
esac
`,
  );
  chmodSync(join(mockBin, "systemctl"), 0o755);
  return mockBin;
}

describe("rollback-units.sh contract", () => {
  it("requires --systemctl-bin and --systemd-dir", () => {
    const mockBin = writeMockBin();
    const systemdDir = mkdtempSync(join(tmpdir(), "fhv-systemd-dir-"));
    const missingSystemctl = runRollback(["--systemd-dir", systemdDir], mockBin);
    expect(missingSystemctl.status).not.toBe(0);
    expect(missingSystemctl.stderr).toMatch(/systemctl-bin/);

    const missingDir = runRollback(["--systemctl-bin", join(mockBin, "systemctl")], mockBin);
    expect(missingDir.status).not.toBe(0);
    expect(missingDir.stderr).toMatch(/systemd-dir/);
  });

  it("preview mode performs no mutation without --confirm", () => {
    const mockBin = writeMockBin();
    const systemdDir = mkdtempSync(join(tmpdir(), "fhv-systemd-dir-"));
    writeFileSync(join(systemdDir, "waia-fhv-campaign.service"), "[Unit]\n");
    const result = runRollback(
      ["--systemctl-bin", join(mockBin, "systemctl"), "--systemd-dir", systemdDir],
      mockBin,
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("No mutation performed");
  });

  it("rejects unknown argv tokens", () => {
    const mockBin = writeMockBin();
    const systemdDir = mkdtempSync(join(tmpdir(), "fhv-systemd-dir-"));
    const result = runRollback(
      [
        "--systemctl-bin",
        join(mockBin, "systemctl"),
        "--systemd-dir",
        systemdDir,
        "--rendered-units-dir",
        "/tmp/nope",
      ],
      mockBin,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown argument/);
  });
});
