import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function runHostProbe(
  args: string[],
  mockBin: string,
): { status: number; stdout: string; stderr: string } {
  const script = join(process.cwd(), "scripts/ops/fhv-t4-host-probe.sh");
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${mockBin}:${process.env.PATH ?? ""}` },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeMockBin(): string {
  const mockBin = mkdtempSync(join(tmpdir(), "fhv-host-probe-mock-"));
  writeFileSync(
    join(mockBin, "python3"),
    `#!/usr/bin/env bash
echo '{"active":{"waia-fhv-campaign.service":"inactive","waia-fhv-observer.service":"inactive"},"enabled":{"waia-fhv-campaign.service":"disabled","waia-fhv-observer.service":"disabled"},"unitFiles":{"waia-fhv-campaign.service":false,"waia-fhv-observer.service":false},"processes":[],"legacy":{"name":"ai-trader-execution-host","image":"waia-execution-host:bp6","running":true},"hostBootId":"11111111-2222-4333-8444-555555555555"}'
`,
  );
  chmodSync(join(mockBin, "python3"), 0o755);
  writeFileSync(join(mockBin, "systemctl"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(mockBin, "systemctl"), 0o755);
  writeFileSync(join(mockBin, "docker"), "#!/usr/bin/env bash\nexit 0\n");
  chmodSync(join(mockBin, "docker"), 0o755);
  return mockBin;
}

describe("fhv-t4-host-probe.sh parser", () => {
  it("requires bound python/systemctl/docker/installed-units-dir", () => {
    const mockBin = writeMockBin();
    const missing = runHostProbe([], mockBin);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/python-bin/);
  });

  it("emits JSON probe with required flags", () => {
    const mockBin = writeMockBin();
    const installedDir = mkdtempSync(join(tmpdir(), "fhv-units-dir-"));
    const result = runHostProbe(
      [
        "--python-bin",
        join(mockBin, "python3"),
        "--systemctl-bin",
        join(mockBin, "systemctl"),
        "--docker-bin",
        join(mockBin, "docker"),
        "--installed-units-dir",
        installedDir,
      ],
      mockBin,
    );
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as {
      processes: unknown[];
      legacy: { running: boolean };
    };
    expect(Array.isArray(parsed.processes)).toBe(true);
    expect(parsed.legacy.running).toBe(true);
  });

  it("rejects unknown argv", () => {
    const mockBin = writeMockBin();
    const installedDir = mkdtempSync(join(tmpdir(), "fhv-units-dir-"));
    const result = runHostProbe(
      [
        "--python-bin",
        join(mockBin, "python3"),
        "--systemctl-bin",
        join(mockBin, "systemctl"),
        "--docker-bin",
        join(mockBin, "docker"),
        "--installed-units-dir",
        installedDir,
        "--bogus",
      ],
      mockBin,
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown argument/);
  });
});
