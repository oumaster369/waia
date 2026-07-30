import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const FAKE_SSH_PY = join(dirname(fileURLToPath(import.meta.url)), "fhv-t4a-fake-ssh.py");

export type FakeSshLogEntry = Readonly<{
  argv: readonly string[];
  target: string;
  remoteParts: readonly string[];
  remoteCommand: string;
  stdinPresent: boolean;
  stdinByteLength: number;
  stdinSha256: string | null;
  exitStatus: number;
}>;

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function readFakeSshLog(logPath: string): FakeSshLogEntry[] {
  if (!existsSync(logPath)) {
    return [];
  }
  return readFileSync(logPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeSshLogEntry);
}

export function sha256HexBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export const OLD_RELEASE_SHA = "7655e86296702b7032dfb1fb4f6d3752a288e23d";

let oldReleaseRevEnsured = false;

export function ensureOldReleaseRevAvailable(): void {
  if (oldReleaseRevEnsured) {
    return;
  }
  const probe = spawnSync("git", ["-C", ROOT, "cat-file", "-e", `${OLD_RELEASE_SHA}^{commit}`], {
    encoding: "utf8",
  });
  if (probe.status !== 0) {
    execFileSync("git", ["-C", ROOT, "fetch", "origin", OLD_RELEASE_SHA, "--depth", "1"], {
      stdio: "pipe",
    });
  }
  oldReleaseRevEnsured = true;
}

export function resolveObservedHostname(): string {
  return execFileSync("hostname", { encoding: "utf8" }).trim();
}

export function resolveMachineIdSha256(): string {
  return execFileSync("bash", ["-c", "sha256sum /etc/machine-id | awk '{print $1}'"], {
    encoding: "utf8",
  }).trim();
}

export function gitShowBlobBytes(rev: string, path: string): Buffer {
  ensureOldReleaseRevAvailable();
  return execFileSync("git", ["-C", ROOT, "show", `${rev}:${path}`]);
}

export function createOldReleaseWorktree(): {
  releaseRoot: string;
  sha: string;
  tag: string;
  originUrl: string;
} {
  ensureOldReleaseRevAvailable();
  const releaseRoot = mkdtempSync(join(tmpdir(), "fhv-old-release-"));
  execFileSync("git", ["-C", ROOT, "worktree", "add", "--detach", releaseRoot, OLD_RELEASE_SHA], {
    stdio: "pipe",
  });
  const nodeModulesLink = join(releaseRoot, "node_modules");
  if (!existsSync(nodeModulesLink)) {
    symlinkSync(join(ROOT, "node_modules"), nodeModulesLink);
  }
  const sha = execFileSync("git", ["-C", releaseRoot, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const tag = "v2026.07.29.7655e86";
  execFileSync("git", ["-C", releaseRoot, "tag", "-f", tag, sha], { stdio: "pipe" });
  const originUrl = execFileSync("git", ["-C", releaseRoot, "remote", "get-url", "origin"], {
    encoding: "utf8",
  }).trim();
  return { releaseRoot, sha, tag, originUrl };
}

export function removeOldReleaseWorktree(releaseRoot: string): void {
  try {
    execFileSync("git", ["-C", ROOT, "worktree", "remove", "--force", releaseRoot], {
      stdio: "pipe",
    });
  } catch {
    // best-effort cleanup for isolated temp worktrees
  }
}

export function gitShowBlob(rev: string, path: string): string {
  ensureOldReleaseRevAvailable();
  return execFileSync("git", ["-C", ROOT, "show", `${rev}:${path}`], { encoding: "utf8" });
}

export function parseBashSArgs(remoteCommand: string): string[] {
  const marker = "bash -s --";
  const idx = remoteCommand.indexOf(marker);
  if (idx === -1) {
    return [];
  }
  const tail = remoteCommand.slice(idx + marker.length).trim();
  if (!tail) {
    return [];
  }
  return [...tail.matchAll(/'((?:\\'|[^'])*)'/g)].map((match) => match[1]!.replace(/\\'/g, "'"));
}

export function stripSudoPrefix(command: string): string {
  return command.replace(/^sudo\s+-n\s+/, "");
}

export type LinuxSystemdSandbox = Readonly<{
  root: string;
  foreignCwd: string;
  systemdDir: string;
  systemctlBin: string;
  pythonBin: string;
  hostname: string;
  machineIdSha256: string;
  bootId: string;
}>;

export function createLinuxSystemdSandbox(): LinuxSystemdSandbox {
  const root = mkdtempSync(join(tmpdir(), "fhv-preauth-sandbox-"));
  const foreignCwd = join(root, "foreign-empty-cwd");
  const systemdDir = join(root, "systemd");
  const binDir = join(root, "bin");
  mkdirSync(foreignCwd, { recursive: true });
  mkdirSync(systemdDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const observerUnit = join(systemdDir, "waia-fhv-observer.service");
  const campaignUnit = join(systemdDir, "waia-fhv-campaign.service");
  writeFileSync(
    observerUnit,
    "[Service]\nEnvironment=FHV_RUN_ID=old-run\nEnvironment=FHV_TARGET_SHA=deadbeef\n",
  );
  writeFileSync(campaignUnit, "[Service]\n");

  const hostname = resolveObservedHostname();
  const machineIdSha256 = resolveMachineIdSha256();
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();

  const pythonBin = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
  const systemctlBin = join(binDir, "systemctl");
  writeFileSync(
    systemctlBin,
    `#!/usr/bin/env bash
set -euo pipefail
SYSTEMD_DIR="${systemdDir}"
cmd="\${1:-}"
shift || true
case "$cmd" in
  is-active)
    unit="\${1:-}"
    if [[ ! -f "$SYSTEMD_DIR/$unit" ]]; then
      echo "inactive"
      exit 3
    fi
    echo "inactive"
    exit 3
    ;;
  is-enabled)
    unit="\${1:-}"
    if [[ ! -f "$SYSTEMD_DIR/$unit" ]]; then
      echo "disabled"
      exit 1
    fi
    echo "disabled"
    exit 1
    ;;
  show)
    prop=""
    unit=""
    while [[ $# -gt 0 ]]; do
      case "$1" in
        -p) prop="\${2:-}"; shift 2 ;;
        --value) shift; continue ;;
        *) unit="$1"; shift ;;
      esac
    done
    case "$prop" in
      LoadState) echo "loaded" ;;
      UnitFileState) echo "disabled" ;;
      ActiveState) echo "inactive" ;;
      SubState) echo "dead" ;;
      FragmentPath) echo "$SYSTEMD_DIR/$unit" ;;
      ExecStart) echo "{}" ;;
      WorkingDirectory) echo "" ;;
      EnvironmentFile) echo "" ;;
      *) echo "" ;;
    esac
    exit 0
    ;;
  --version)
    echo "fake-systemctl"
    exit 0
    ;;
  stop|disable|daemon-reload)
    echo "mutating:$cmd" >&2
    exit 1
    ;;
  *)
    echo "unsupported systemctl: $cmd $*" >&2
    exit 2
    ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(systemctlBin, 0o755);

  return {
    root,
    foreignCwd,
    systemdDir,
    systemctlBin,
    pythonBin,
    hostname,
    machineIdSha256,
    bootId,
  };
}

export function runCommittedScriptViaBashStdin(input: {
  scriptPath: string;
  rev?: string;
  args: readonly string[];
  foreignCwd: string;
  env?: NodeJS.ProcessEnv;
}): { exitCode: number | null; stdout: string; stderr: string } {
  const body =
    input.rev !== undefined
      ? gitShowBlob(input.rev, input.scriptPath)
      : readFileSync(join(process.cwd(), input.scriptPath), "utf8");
  const result = spawnSync("bash", ["-s", "--", ...input.args], {
    cwd: input.foreignCwd,
    input: body,
    encoding: "utf8",
    env: { ...process.env, ...(input.env ?? {}) },
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function writeFakeSshExecutable(input: {
  binDir: string;
  foreignCwd: string;
  logPath: string;
}): string {
  mkdirSync(input.binDir, { recursive: true });
  mkdirSync(dirname(input.logPath), { recursive: true });
  writeFileSync(input.logPath, "", { encoding: "utf8" });

  const fakeSshImpl = join(input.binDir, "fhv-fake-ssh.py");
  writeFileSync(fakeSshImpl, readFileSync(FAKE_SSH_PY));

  const fakeSsh = join(input.binDir, "ssh");
  const pythonBin = execFileSync("which", ["python3"], { encoding: "utf8" }).trim();
  writeFileSync(
    fakeSsh,
    `#!/usr/bin/env bash
set -euo pipefail
export FHV_FAKE_SSH_LOG="${input.logPath}"
export FHV_FAKE_SSH_FOREIGN_CWD="${input.foreignCwd}"
export FHV_FAKE_SSH_STUB_BIN="${input.binDir}"
exec "${pythonBin}" "${fakeSshImpl}" "$@"
`,
    { mode: 0o755 },
  );
  chmodSync(fakeSshImpl, 0o755);
  return fakeSsh;
}

export function invokeFakeSsh(input: {
  fakeSsh: string;
  remoteCommand: string | readonly string[];
  stdin?: string | Buffer;
  env?: NodeJS.ProcessEnv;
}): { exitCode: number | null; stdout: string; stderr: string } {
  const remoteArgs = Array.isArray(input.remoteCommand)
    ? input.remoteCommand
    : [input.remoteCommand];
  const sshBase = [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=30",
    "-o",
    "ServerAliveInterval=15",
    "operator@exec.test",
    ...remoteArgs,
  ];
  const stdinBody =
    input.stdin === undefined
      ? undefined
      : Buffer.isBuffer(input.stdin)
        ? input.stdin
        : Buffer.from(input.stdin, "utf8");
  const result = spawnSync(input.fakeSsh, sshBase, {
    input: stdinBody,
    encoding: "utf8",
    env: input.env ?? process.env,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function writeHostPreflightStubs(input: {
  binDir: string;
  sandboxRoot: string;
  serviceUser: string;
  canonicalHostname: string;
  envFile: string;
  artifactRoot: string;
  checkoutParent: string;
  legacyContainerName: string;
  legacyContainerImage: string;
}): {
  nodeBin: string;
  corepackBin: string;
  gitBin: string;
  dockerBin: string;
  systemdAnalyzeBin: string;
} {
  mkdirSync(input.checkoutParent, { recursive: true });
  mkdirSync(input.artifactRoot, { recursive: true });
  mkdirSync(dirnameSafe(input.artifactRoot), { recursive: true });
  chmodSync(input.checkoutParent, 0o777);
  chmodSync(input.artifactRoot, 0o777);
  chmodSync(dirnameSafe(input.artifactRoot), 0o777);
  writeFileSync(
    input.envFile,
    "FHV_HOST_OS_QUALIFIED=true\nFHV_COMMAND_ENFORCEMENT_ENABLED=true\n",
    { mode: 0o644 },
  );

  const hostnameBin = join(input.binDir, "hostname");
  writeFileSync(
    hostnameBin,
    `#!/usr/bin/env bash
if [[ "\${1:-}" == "-f" ]]; then
  printf '%s\\n' "${input.canonicalHostname}"
  exit 0
fi
printf '%s\\n' "${input.canonicalHostname}"
`,
    { mode: 0o755 },
  );

  const nodeBin = join(input.binDir, "node");
  writeFileSync(
    nodeBin,
    `#!/usr/bin/env bash
exec "${process.execPath}" "$@"
`,
    { mode: 0o755 },
  );

  const corepackBin = join(input.binDir, "corepack");
  writeFileSync(
    corepackBin,
    `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then exit 0; fi
exit 0
`,
    { mode: 0o755 },
  );

  const gitBin = join(input.binDir, "git");
  writeFileSync(
    gitBin,
    `#!/usr/bin/env bash
exec /usr/bin/git "$@"
`,
    { mode: 0o755 },
  );

  const dockerBin = join(input.binDir, "docker");
  writeFileSync(
    dockerBin,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == "inspect" ]]; then
  if [[ "$2" == "-f" && "$3" == "{{.State.Status}}" ]]; then
    echo "running"
    exit 0
  fi
  if [[ "$2" == "-f" && "$3" == "{{.Config.Image}}" ]]; then
    echo "${input.legacyContainerImage}"
    exit 0
  fi
  exit 0
fi
exit 2
`,
    { mode: 0o755 },
  );

  const systemdAnalyzeBin = join(input.binDir, "systemd-analyze");
  writeFileSync(
    systemdAnalyzeBin,
    `#!/usr/bin/env bash
if [[ "$1" == "critical-chain" ]]; then exit 0; fi
if [[ "$1" == "--version" ]]; then exit 0; fi
exit 0
`,
    { mode: 0o755 },
  );

  return {
    nodeBin,
    corepackBin,
    gitBin,
    dockerBin,
    systemdAnalyzeBin,
  };
}

function dirnameSafe(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "." : path.slice(0, idx);
}

export function canRunLinuxPreauthLiveProof(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  if (!existsSync("/etc/machine-id") || !existsSync("/proc/sys/kernel/random/boot_id")) {
    return false;
  }
  const sudoProbe = spawnSync("sudo", ["-n", "true"], { encoding: "utf8" });
  return sudoProbe.status === 0;
}
