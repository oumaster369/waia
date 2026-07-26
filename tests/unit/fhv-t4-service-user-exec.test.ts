import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/ops/fhv-t4-service-user-exec.sh");

let root = "";

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = "";
  }
});

function run(
  args: string[],
  opts?: { env?: NodeJS.ProcessEnv },
): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...(opts?.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const err = error as {
      status?: number | null;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

const VALID_ENV_FILE = [
  "FHV_HOST_OS_QUALIFIED=true",
  "FHV_COMMAND_ENFORCEMENT_ENABLED=true",
  "FHV_OPERATOR_COMMAND_SECRET=test-secret",
  "FHV_OBSERVER_TUNNEL_SECRET=test-tunnel",
].join("\n");

describe("fhv-t4-service-user-exec.sh (DEE-436)", () => {
  it("rejects unallowlisted package command", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-sue-"));
    const envFile = join(root, "env");
    writeFileSync(envFile, `${VALID_ENV_FILE}\n`);
    const result = run([
      "--service-user",
      "nobody",
      "--environment-file",
      envFile,
      "--repo-root",
      root,
      "--node-bin",
      process.execPath,
      "--corepack-bin",
      process.execPath,
      "--",
      "trader:fhv:t4:not-a-real-script",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not allowlisted/);
  });

  it("rejects secret argv flags before privilege transition", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-sue-secret-"));
    const envFile = join(root, "env");
    writeFileSync(envFile, `${VALID_ENV_FILE}\n`);
    for (const flag of ["--command-secret", "--tunnel-secret"]) {
      const result = run([
        "--service-user",
        "nobody",
        "--environment-file",
        envFile,
        "--repo-root",
        root,
        "--node-bin",
        process.execPath,
        "--corepack-bin",
        process.execPath,
        "--",
        "trader:fhv:t4:verify-paused",
        flag,
        "super-secret-value-should-not-leak",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/secret flags are forbidden/);
      expect(result.stdout).not.toContain("super-secret-value-should-not-leak");
      expect(result.stderr).not.toContain("super-secret-value-should-not-leak");
    }
  });

  it("rejects shell metacharacters via early path validation without interpolating them", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-sue-meta-"));
    const envFile = join(root, "env");
    writeFileSync(envFile, `${VALID_ENV_FILE}\n`);
    const result = run([
      "--service-user",
      "nobody",
      "--environment-file",
      `${envFile};touch ${join(root, "pwned")}`,
      "--repo-root",
      root,
      "--node-bin",
      process.execPath,
      "--corepack-bin",
      process.execPath,
      "--",
      "trader:fhv:t4:verify-paused",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/environment file missing|No such file|FHV_T4_ENVIRONMENT/i);
  });

  it("rejects unknown wrapper flags", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-sue-flag-"));
    const envFile = join(root, "env");
    writeFileSync(envFile, `${VALID_ENV_FILE}\n`);
    const result = run([
      "--service-user",
      "nobody",
      "--environment-file",
      envFile,
      "--repo-root",
      root,
      "--evil",
      "1",
      "--",
      "trader:fhv:t4:verify-paused",
    ]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown argument/);
  });
});
