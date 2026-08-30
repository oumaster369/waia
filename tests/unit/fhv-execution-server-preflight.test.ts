import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/ops/fhv-execution-server-preflight.sh");
const EXPECTED_ARGS = [
  "--expected-ip",
  "84.32.109.46",
  "--expected-hostname",
  "waia-execution-historical",
  "--expected-checkout",
  "/opt/waia/waia-hostqual",
];

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("FHV execution-server preflight target binding", () => {
  it("passes the local fixture only when the target identity is explicit", () => {
    const result = run(["--fixture-local", ...EXPECTED_ARGS]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("EXECUTION_SERVER_PREFLIGHT=PASS\n");
  });

  it.each([
    {
      args: ["--fixture-local"],
      reason: "EXPECTED_IP_REQUIRED",
    },
    {
      args: ["--fixture-local", "--expected-ip", "84.32.109.46"],
      reason: "EXPECTED_HOSTNAME_REQUIRED",
    },
    {
      args: [
        "--fixture-local",
        "--expected-ip",
        "84.32.109.46",
        "--expected-hostname",
        "waia-execution-historical",
      ],
      reason: "EXPECTED_CHECKOUT_REQUIRED",
    },
  ])("fails closed when $reason is omitted", ({ args, reason }) => {
    const result = run(args);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`EXECUTION_SERVER_PREFLIGHT=BLOCKED_${reason}\n`);
  });

  it.each([
    {
      replacement: ["--expected-ip", "not-an-ip"],
      reason: "EXPECTED_IP_INVALID",
    },
    {
      replacement: ["--expected-hostname", "bad hostname"],
      reason: "EXPECTED_HOSTNAME_INVALID",
    },
    {
      replacement: ["--expected-checkout", "/opt/waia/../escape"],
      reason: "EXPECTED_CHECKOUT_INVALID",
    },
  ])("rejects unsafe or invalid target input: $reason", ({ replacement, reason }) => {
    const args = [...EXPECTED_ARGS];
    const flagIndex = args.indexOf(replacement[0]);
    args.splice(flagIndex, 2, ...replacement);

    const result = run(["--fixture-local", ...args]);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`EXECUTION_SERVER_PREFLIGHT=BLOCKED_${reason}\n`);
  });

  it.each([
    {
      env: { FHV_PREFLIGHT_FIXTURE_IP: "185.189.46.53" },
      reason: "IP_MISMATCH",
    },
    {
      env: { FHV_PREFLIGHT_FIXTURE_HOSTNAME: "waia-dee536-execution-candidate" },
      reason: "HOSTNAME_MISMATCH",
    },
  ])("rejects stale-server fixture facts: $reason", ({ env, reason }) => {
    const result = run(["--fixture-local", ...EXPECTED_ARGS], env);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`EXECUTION_SERVER_PREFLIGHT=BLOCKED_${reason}\n`);
  });

  it("renders an operator command bound to the explicitly supplied target", () => {
    const result = run(["--prepare-only", ...EXPECTED_ARGS]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("root@84.32.109.46");
    expect(result.stdout).toContain("hostname=waia-execution-historical");
    expect(result.stdout).toContain("checkout=/opt/waia/waia-hostqual");
    expect(result.stdout).not.toContain("185.189.46.53");
    expect(result.stdout).not.toContain("waia-dee536-execution-candidate");
  });

  it("compares the expected IP with the IP reported by the remote host", () => {
    const binDir = mkdtempSync(join(tmpdir(), "fhv-preflight-bin-"));
    const identity = join(binDir, "identity");
    const ssh = join(binDir, "ssh");
    writeFileSync(identity, "fixture\n", { mode: 0o600 });
    writeFileSync(
      ssh,
      `#!/usr/bin/env bash
printf '%s\\n' '{"hostname":"waia-execution-historical","ip":"185.189.46.53","node":"v22.23.0","fstype":"xfs","checkout_exists":"yes","work_exists":"yes","checkout_sha":"475a6a012bcd95e31384b6fec053f5bcc7f47c13"}'
`,
    );
    chmodSync(ssh, 0o700);

    const result = run(
      [
        "--execute",
        "--release-sha",
        "475a6a012bcd95e31384b6fec053f5bcc7f47c13",
        ...EXPECTED_ARGS,
      ],
      {
        FHV_EXECUTION_SERVER_SSH_IDENTITY: identity,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("EXECUTION_SERVER_PREFLIGHT=BLOCKED_IP_MISMATCH\n");
  });

  it("fails with an explicit reason when SSH cannot reach the target", () => {
    const binDir = mkdtempSync(join(tmpdir(), "fhv-preflight-bin-"));
    const identity = join(binDir, "identity");
    const ssh = join(binDir, "ssh");
    writeFileSync(identity, "fixture\n", { mode: 0o600 });
    writeFileSync(ssh, "#!/usr/bin/env bash\nexit 255\n");
    chmodSync(ssh, 0o700);

    const result = run(
      [
        "--execute",
        "--release-sha",
        "475a6a012bcd95e31384b6fec053f5bcc7f47c13",
        ...EXPECTED_ARGS,
      ],
      {
        FHV_EXECUTION_SERVER_SSH_IDENTITY: identity,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
      },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("EXECUTION_SERVER_PREFLIGHT=BLOCKED_SSH_UNREACHABLE\n");
  });
});
