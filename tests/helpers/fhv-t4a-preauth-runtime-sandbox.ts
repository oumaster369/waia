import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const OLD_RELEASE_SHA = "7655e86296702b7032dfb1fb4f6d3752a288e23d";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function gitShowBlob(rev: string, path: string): string {
  return execFileSync("git", ["show", `${rev}:${path}`], { encoding: "utf8" });
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

  const hostname = execFileSync("hostname", { encoding: "utf8" }).trim();
  const machineIdRaw = readFileSync("/etc/machine-id", "utf8").replace(/\n/g, "");
  const machineIdSha256 = sha256Hex(machineIdRaw);
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
  preflightEnv?: Record<string, string>;
}): string {
  const fakeSsh = join(input.binDir, "ssh");
  writeFileSync(
    fakeSsh,
    `#!/usr/bin/env bash
set -euo pipefail
LOG="${input.logPath}"
FOREIGN_CWD="${input.foreignCwd}"
printf '%s\\n' "$*" >> "$LOG"
REMOTE="\${!#}"
STDIN="$(cat || true)"
exec_remote() {
  local cmd="$1"
  cd "$FOREIGN_CWD"
  bash -c "$cmd"
}
case "$REMOTE" in
  "sudo -n true")
    if sudo -n true 2>/dev/null; then exit 0; fi
    exit 0
    ;;
  sudo\\ -n\\ test\\ -x\\ *)
    path="\${REMOTE#sudo -n test -x }"
    path="\${path#\\'}"
    path="\${path%\\'}"
    if [[ -x "$path" ]]; then exit 0; fi
    exit 1
    ;;
  sudo\\ -n\\ bash\\ -s\\ --*)
    args="\${REMOTE#sudo -n bash -s -- }"
    cd "$FOREIGN_CWD"
    printf '%s' "$STDIN" | sudo -n bash -s -- $args
    exit $?
    ;;
  bash\\ -s\\ --*)
    args="\${REMOTE#bash -s -- }"
    cd "$FOREIGN_CWD"
    printf '%s' "$STDIN" | bash -s -- $args
    exit $?
    ;;
  *)
    cd "$FOREIGN_CWD"
    bash -c "$REMOTE"
    ;;
esac
`,
    { mode: 0o755 },
  );
  return fakeSsh;
}

export function writeHostPreflightStubs(input: {
  binDir: string;
  sandboxRoot: string;
  serviceUser: string;
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
  writeFileSync(
    input.envFile,
    "FHV_HOST_OS_QUALIFIED=true\nFHV_COMMAND_ENFORCEMENT_ENABLED=true\n",
    { mode: 0o644 },
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
