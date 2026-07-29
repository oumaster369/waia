import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/ops/fhv-t4-service-user-exec.sh");
const REPO_ROOT = process.cwd();
const TSX_PKG = join(REPO_ROOT, "node_modules/tsx");

const bashSupportsMapfile = (() => {
  try {
    execFileSync("bash", ["-c", "declare -f mapfile >/dev/null 2>&1"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const ALLOWLIST = [
  "trader:fhv:rehearsal",
  "trader:fhv:t4:arm-pause",
  "trader:fhv:t4:resume",
  "trader:fhv:t4:status",
  "trader:fhv:t4:write-observer-qualification-proof",
  "trader:fhv:t4:verify",
  "trader:fhv:t4:verify-paused",
  "trader:fhv:t4:verify-final",
  "trader:fhv:t4:wait-paused",
  "trader:fhv:t4:wait-final",
  "trader:fhv:t4:verify-deployment",
  "trader:fhv:t4:verify-rollback",
  "trader:fhv:t4:seal-evidence",
  "trader:fhv:t4:verify-seal",
  "trader:fhv:t4:verify-ceremony",
  "trader:fhv:t4:capture-continuity-before",
  "trader:fhv:t4:capture-continuity-after",
  "trader:fhv:t4:verify-continuity",
  "trader:fhv:t4:build-evidence-inventory",
  "trader:fhv:t4:ingest-host-probe",
  "trader:fhv:t4:record-checkout-identity",
] as const;

const VALID_ENV_FILE = [
  "FHV_HOST_OS_QUALIFIED=true",
  "FHV_COMMAND_ENFORCEMENT_ENABLED=true",
  "FHV_OPERATOR_COMMAND_SECRET=test-secret",
  "FHV_OBSERVER_TUNNEL_SECRET=test-tunnel",
  "FHV_RUN_ROOT=/opt/waia/fhv-artifacts/RI-P7/fhv-ops-rehearsal/test-run",
  "FHV_RUN_ID=fhv-t4a-test-run",
  "FHV_ORGANIZATION_ID=00000000-0000-4000-8000-000000000001",
  "FHV_TARGET_SHA=0000000000000000000000000000000000000000",
].join("\n");

type Harness = {
  root: string;
  foreignCwd: string;
  repoRoot: string;
  envFile: string;
  binDir: string;
  nodeBin: string;
  corepackBin: string;
  parserCwdLog: string;
  pnpmEnvLog: string;
};

let harness: Harness | null = null;

function runScript(
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string | undefined> },
): { status: number | null; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: opts?.cwd ?? process.cwd(),
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

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "fhv-sue-harness-"));
  const foreignCwd = join(root, "foreign-root-cwd");
  const repoRoot = REPO_ROOT;
  const envFile = join(root, "fhv.env");
  const binDir = join(root, "bin");
  const parserCwdLog = join(root, "parser-cwd.log");
  const pnpmEnvLog = join(root, "pnpm-env.log");

  mkdirSync(foreignCwd, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(envFile, `${VALID_ENV_FILE}\n`);

  writeFileSync(
    join(binDir, "id"),
    `#!/bin/bash
if [[ "$1" == "-u" ]]; then
  if [[ -z "\${2:-}" || "$2" == "root" || "$2" == "0" ]]; then
    echo 0
    exit 0
  fi
  echo 995
  exit 0
fi
echo 0
`,
    { mode: 0o755 },
  );

  writeFileSync(
    join(binDir, "getent"),
    `#!/bin/bash
if [[ "$1" == "passwd" ]]; then
  echo "nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin"
fi
`,
    { mode: 0o755 },
  );

  writeFileSync(
    join(binDir, "runuser"),
    `#!/bin/bash
while [[ "$1" == -* ]]; do shift; done
shift
[[ "$1" == "--" ]] && shift
exec "$@"
`,
    { mode: 0o755 },
  );

  const nodeBin = join(binDir, "node");
  writeFileSync(
    nodeBin,
    `#!/bin/bash
REAL_NODE="${process.execPath}"
LOG="${parserCwdLog}"
for arg in "$@"; do
  if [[ "$arg" == "--import" ]]; then
    printf '%s' "$PWD" > "$LOG"
    break
  fi
done
exec "$REAL_NODE" "$@"
`,
    { mode: 0o755 },
  );

  const corepackBin = join(binDir, "corepack");
  writeFileSync(
    corepackBin,
    `#!/bin/bash
if [[ "$1" == "--version" ]]; then
  exit 0
fi
ENV_LOG="${pnpmEnvLog}"
: > "$ENV_LOG"
for key in FHV_RUN_ROOT FHV_RUN_ID FHV_ORGANIZATION_ID FHV_TARGET_SHA FHV_OPERATOR_COMMAND_SECRET FHV_OBSERVER_TUNNEL_SECRET; do
  eval "value=\\$$key"
  if [[ -n "$value" ]]; then
    echo "$key=present" >> "$ENV_LOG"
  else
    echo "$key=missing" >> "$ENV_LOG"
  fi
done
if [[ "$1" == "pnpm@10" && "$2" == "trader:fhv:t4:status" ]]; then
  echo "status=dispatched"
  exit 0
fi
if [[ "$1" == "pnpm@10" && "$2" == "trader:fhv:t4:write-observer-qualification-proof" ]]; then
  echo "classification=FHV_T4_OBSERVER_QUALIFICATION_PROOF_OK"
  exit 0
fi
echo "unexpected corepack invocation: $*" >&2
exit 2
`,
    { mode: 0o755 },
  );

  chmodSync(nodeBin, 0o755);
  chmodSync(corepackBin, 0o755);

  return {
    root,
    foreignCwd,
    repoRoot,
    envFile,
    binDir,
    nodeBin,
    corepackBin,
    parserCwdLog,
    pnpmEnvLog,
  };
}

afterEach(() => {
  if (harness) {
    rmSync(harness.root, { recursive: true, force: true });
    harness = null;
  }
});

describe("fhv-t4-service-user-exec.sh (DEE-436)", () => {
  it("keeps the exact allowlist including observer qualification proof", () => {
    const source = readFileSync(SCRIPT, "utf8");
    for (const entry of ALLOWLIST) {
      expect(source).toContain(`"${entry}"`);
    }
    expect(source.match(/ALLOWLIST=\(/g)?.length).toBe(1);
    expect(source).not.toContain("trader:fhv:t4:*");
  });

  it("passes bash -n syntax validation", () => {
    execFileSync("bash", ["-n", SCRIPT], { stdio: "ignore" });
  });

  it("resolves repo-local tsx from REPO_ROOT", () => {
    expect(existsSync(TSX_PKG)).toBe(true);
  });

  it("rejects unallowlisted package command", () => {
    harness = createHarness();
    const result = runScript(
      [
        "--service-user",
        "nobody",
        "--environment-file",
        harness.envFile,
        "--repo-root",
        harness.repoRoot,
        "--node-bin",
        harness.nodeBin,
        "--corepack-bin",
        harness.corepackBin,
        "--",
        "trader:fhv:t4:not-a-real-script",
      ],
      { env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/not allowlisted/);
  });

  it("rejects secret argv flags before privilege transition", () => {
    harness = createHarness();
    for (const flag of ["--command-secret", "--tunnel-secret"]) {
      const result = runScript(
        [
          "--service-user",
          "nobody",
          "--environment-file",
          harness.envFile,
          "--repo-root",
          harness.repoRoot,
          "--node-bin",
          harness.nodeBin,
          "--corepack-bin",
          harness.corepackBin,
          "--",
          "trader:fhv:t4:verify-paused",
          flag,
          "super-secret-value-should-not-leak",
        ],
        { env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` } },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/secret flags are forbidden/);
      expect(result.stdout).not.toContain("super-secret-value-should-not-leak");
      expect(result.stderr).not.toContain("super-secret-value-should-not-leak");
    }
  });

  it("rejects shell metacharacters via early path validation without interpolating them", () => {
    harness = createHarness();
    const result = runScript(
      [
        "--service-user",
        "nobody",
        "--environment-file",
        `${harness.envFile};touch ${join(harness.root, "pwned")}`,
        "--repo-root",
        harness.repoRoot,
        "--node-bin",
        harness.nodeBin,
        "--corepack-bin",
        harness.corepackBin,
        "--",
        "trader:fhv:t4:verify-paused",
      ],
      { env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/environment file missing|No such file|FHV_T4_ENVIRONMENT/i);
  });

  it("rejects unknown wrapper flags", () => {
    harness = createHarness();
    const result = runScript(
      [
        "--service-user",
        "nobody",
        "--environment-file",
        harness.envFile,
        "--repo-root",
        harness.repoRoot,
        "--evil",
        "1",
        "--",
        "trader:fhv:t4:verify-paused",
      ],
      { env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` } },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/unknown argument/);
  });

  it("structurally proves pre-fix tsx resolution fails from a foreign cwd", () => {
    harness = createHarness();
    const parseHelper = join(REPO_ROOT, "scripts/ops/fhv-t4-parse-environment-file.ts");
    let status: number | null = 0;
    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        ["--import", "tsx", parseHelper, "--path", harness.envFile, "--format", "keys"],
        {
          cwd: harness.foreignCwd,
          encoding: "utf8",
          env: { ...process.env, WAIA_TRADER_CLI: "1" },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      const err = error as { status?: number | null; stderr?: string };
      status = err.status ?? 1;
      stderr = err.stderr ?? "";
    }
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/ERR_MODULE_NOT_FOUND|Cannot find package 'tsx'/);
  });

  it("requires repo-root cwd before environment parser import in the released shell", () => {
    const source = readFileSync(SCRIPT, "utf8");
    expect(source).toMatch(
      /mapfile -t PARSED_ENV[\s\S]*cd "\$REPO_ROOT"[\s\S]*--import tsx "\$PARSE_HELPER"/,
    );
  });

  it.skipIf(!bashSupportsMapfile)(
    "invokes the environment parser from REPO_ROOT even when the caller cwd is foreign",
    () => {
      harness = createHarness();
      const result = runScript(
        [
          "--service-user",
          "nobody",
          "--environment-file",
          harness.envFile,
          "--repo-root",
          harness.repoRoot,
          "--node-bin",
          harness.nodeBin,
          "--corepack-bin",
          harness.corepackBin,
          "--",
          "trader:fhv:t4:status",
        ],
        {
          cwd: harness.foreignCwd,
          env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` },
        },
      );
      expect(result.status).toBe(0);
      expect(readFileSync(harness.parserCwdLog, "utf8")).toBe(harness.repoRoot);
      expect(result.stdout).toContain("status=dispatched");
    },
  );

  it.skipIf(!bashSupportsMapfile)(
    "dispatches write-observer-qualification-proof through the exact allowlist",
    () => {
      harness = createHarness();
      const result = runScript(
        [
          "--service-user",
          "nobody",
          "--environment-file",
          harness.envFile,
          "--repo-root",
          harness.repoRoot,
          "--node-bin",
          harness.nodeBin,
          "--corepack-bin",
          harness.corepackBin,
          "--",
          "trader:fhv:t4:write-observer-qualification-proof",
        ],
        {
          cwd: harness.foreignCwd,
          env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` },
        },
      );
      expect(result.status).toBe(0);
      expect(readFileSync(harness.parserCwdLog, "utf8")).toBe(harness.repoRoot);
      expect(result.stdout).toContain("FHV_T4_OBSERVER_QUALIFICATION_PROOF_OK");
    },
  );

  it.skipIf(!bashSupportsMapfile)(
    "loads required variable names without printing secret values",
    () => {
      harness = createHarness();
      const result = runScript(
        [
          "--service-user",
          "nobody",
          "--environment-file",
          harness.envFile,
          "--repo-root",
          harness.repoRoot,
          "--node-bin",
          harness.nodeBin,
          "--corepack-bin",
          harness.corepackBin,
          "--",
          "trader:fhv:t4:status",
        ],
        {
          cwd: harness.foreignCwd,
          env: { PATH: `${harness.binDir}:${process.env.PATH ?? ""}` },
        },
      );
      expect(result.status).toBe(0);
      const envLog = readFileSync(harness.pnpmEnvLog, "utf8");
      for (const key of [
        "FHV_RUN_ROOT",
        "FHV_RUN_ID",
        "FHV_ORGANIZATION_ID",
        "FHV_TARGET_SHA",
        "FHV_OPERATOR_COMMAND_SECRET",
        "FHV_OBSERVER_TUNNEL_SECRET",
      ]) {
        expect(envLog).toContain(`${key}=present`);
      }
      expect(result.stdout).not.toContain("test-secret");
      expect(result.stderr).not.toContain("test-secret");
      expect(result.stdout).not.toContain("test-tunnel");
      expect(result.stderr).not.toContain("test-tunnel");
    },
  );
});
