import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FHV_T4A_DIRECT_EXECUTION_SCRIPTS,
  FHV_T4A_REQUIRED_EXECUTABLE_GIT_MODE,
  FHV_T4A_SSH_STDIN_SCRIPT_PATHS,
  fhvT4aDirectExecutionScriptPaths,
} from "@/lib/trader/observability/fhv-t4a-direct-execution-contract";
import { deriveFhvT4aExecutionGraphFromSources } from "@/lib/trader/observability/fhv-t4a-execution-graph-derive";
import { executeFhvT4aStep } from "@/lib/trader/observability/fhv-t4a-operator-executor";
import { createFhvT4aHermeticTransport } from "@/lib/trader/observability/fhv-t4a-hermetic-transport";
import type { FhvT4aOperatorTransport } from "@/lib/trader/observability/fhv-t4a-operator-transport";
import type { FhvT4aOperatorBindings } from "@/lib/trader/observability/fhv-t4a-binding-spec";
import { buildFhvT4aExecContext } from "@/lib/trader/observability/fhv-t4a-operator-executor";

const ROOT = process.cwd();
const GIT_BIN = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
const PYTHON_BIN = process.env.FHV_PYTHON_BIN?.trim() || "/usr/bin/python3";

let cleanupPaths: string[] = [];

afterEach(() => {
  for (const path of cleanupPaths) {
    rmSync(path, { recursive: true, force: true });
  }
  cleanupPaths = [];
});

function trackDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanupPaths.push(dir);
  return dir;
}

function gitLsTreeMode(rev: string, path: string): string {
  const line = execFileSync("git", ["ls-tree", rev, path], { encoding: "utf8" }).trim();
  return line.split(/\s+/)[0] ?? "";
}

function gitIndexMode(path: string): string {
  const line = execFileSync("git", ["ls-files", "-s", path], { encoding: "utf8" }).trim();
  return line.split(/\s+/)[0] ?? "";
}

function gitArchiveCheckout(rev: string, dest: string): void {
  const tarPath = join(trackDir("fhv-archive-tar-"), "repo.tar");
  execFileSync("git", ["archive", "--format=tar", "-o", tarPath, rev], {
    cwd: ROOT,
    stdio: "pipe",
  });
  mkdirSync(dest, { recursive: true });
  execFileSync("tar", ["-xf", tarPath, "-C", dest], { stdio: "pipe" });
}

function materializeIndexCheckout(dest: string, paths: readonly string[]): void {
  mkdirSync(dest, { recursive: true });
  for (const relPath of paths) {
    const out = join(dest, relPath);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, execFileSync("git", ["show", `:${relPath}`], { encoding: "buffer" }));
    const mode = parseInt(gitIndexMode(relPath).slice(-3), 8);
    chmodSync(out, mode);
  }
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function makeRenderedFixture(base: string): string {
  const rendered = join(base, "rendered");
  mkdirSync(rendered, { recursive: true });
  writeFileSync(join(rendered, "waia-fhv-campaign.service"), "[Unit]\nDescription=campaign\n");
  writeFileSync(join(rendered, "waia-fhv-observer.service"), "[Unit]\nDescription=observer\n");
  return rendered;
}

function hermeticBindings(targetSha: string, work: string): FhvT4aOperatorBindings {
  const localStateDir = join(work, "state");
  mkdirSync(localStateDir, { recursive: true });
  return {
    execHost: "exec.test",
    sshUser: "operator",
    localReleaseRoot: join(work, "release"),
    localStateDir,
    localNodeBin: process.execPath,
    localGitBin: GIT_BIN,
    localSshBin: execFileSync("which", ["ssh"], { encoding: "utf8" }).trim(),
    targetSha,
    releaseTag: "v2026.07.27.test436",
    originUrl: "https://github.com/oumaster369/waia.git",
    runId: "fhv-t4a-step11-exec-test",
    organizationId: "00000000-0000-4000-8000-000000000436",
    operatorId: "operator-test",
    serviceUser: "waia-fhv",
    environmentFile: join(work, "fhv.env"),
    artifactRoot: join(work, "artifacts"),
    checkoutParent: join(work, "checkouts"),
    expectedHostname: "exec.test",
    expectedMachineIdSha256: "a".repeat(64),
    workstationTracePath: join(localStateDir, "trace.jsonl"),
    nodeBin: process.execPath,
    corepackBin: "/usr/bin/corepack",
    gitBin: GIT_BIN,
    pythonBin: PYTHON_BIN,
    dockerBin: "/usr/bin/false",
    systemctlBin: "/usr/bin/systemctl",
    systemdAnalyzeBin: "/usr/bin/systemd-analyze",
  };
}

function createHermeticFixture(targetSha: string) {
  const work = trackDir("fhv-hermetic-work-");
  const bindings = hermeticBindings(targetSha, work);
  mkdirSync(bindings.checkoutParent, { recursive: true });
  mkdirSync(bindings.artifactRoot, { recursive: true });
  writeFileSync(bindings.environmentFile, "FHV_TEST=1\n");
  const transport = createFhvT4aHermeticTransport({
    localReleaseRoot: ROOT,
    targetSha,
    releaseTag: bindings.releaseTag,
    originUrl: bindings.originUrl,
    serviceUser: bindings.serviceUser,
    serviceUserHome: join(work, "home"),
    checkoutParent: bindings.checkoutParent,
    artifactRoot: bindings.artifactRoot,
    environmentFile: bindings.environmentFile,
    runId: bindings.runId,
    organizationId: bindings.organizationId,
    nodeBin: bindings.nodeBin,
    corepackBin: bindings.corepackBin,
    gitBin: bindings.gitBin,
    pythonBin: bindings.pythonBin,
    dockerBin: bindings.dockerBin,
    systemctlBin: bindings.systemctlBin,
    systemdAnalyzeBin: bindings.systemdAnalyzeBin,
    operatorId: bindings.operatorId,
  });
  return { bindings, transport, work };
}

describe("fhv-t4a direct execution executable Git modes (DEE-436 step 11 closure)", () => {
  it("mechanically derives the same direct and SSH-stdin sets as the canonical contract", () => {
    const derived = deriveFhvT4aExecutionGraphFromSources(ROOT);
    const matrixDirect = [...fhvT4aDirectExecutionScriptPaths()].sort();
    const matrixStdin = [...FHV_T4A_SSH_STDIN_SCRIPT_PATHS].sort();
    expect(derived.directPaths).toEqual(matrixDirect);
    expect(derived.sshStdinPaths).toEqual(matrixStdin);
    expect(derived.directPaths).toHaveLength(13);
    expect(derived.sshStdinPaths).toHaveLength(4);
    expect(derived.sourcedPaths.length).toBeGreaterThan(0);
    for (const path of derived.directPaths) {
      expect(path.startsWith("scripts/ops/")).toBe(true);
    }
    for (const path of derived.sshStdinPaths) {
      expect(derived.directPaths).not.toContain(path);
    }
  });

  it("records the Steps 1–32 direct-execution matrix with required Git mode 100755", () => {
    const derived = deriveFhvT4aExecutionGraphFromSources(ROOT);
    expect(fhvT4aDirectExecutionScriptPaths()).toHaveLength(derived.directPaths.length);
    for (const entry of FHV_T4A_DIRECT_EXECUTION_SCRIPTS) {
      expect(entry.invocation).toBe("direct-path");
      expect(entry.path.startsWith("scripts/ops/")).toBe(true);
      expect(entry.steps.length).toBeGreaterThan(0);
    }
    expect(
      FHV_T4A_DIRECT_EXECUTION_SCRIPTS.some((entry) =>
        entry.path.endsWith("fhv-t4-rendered-unit-digests.sh"),
      ),
    ).toBe(true);
  });

  it("requires executable Git mode 100755 for every direct-execution script in the Git index", () => {
    for (const path of fhvT4aDirectExecutionScriptPaths()) {
      const mode = gitIndexMode(path);
      expect(mode, `${path} must be ${FHV_T4A_REQUIRED_EXECUTABLE_GIT_MODE}`).toBe(
        FHV_T4A_REQUIRED_EXECUTABLE_GIT_MODE,
      );
    }
  });

  it("uses LF line endings and shebang on every direct-execution script", () => {
    for (const path of fhvT4aDirectExecutionScriptPaths()) {
      const body = readFileSync(join(ROOT, path), "utf8");
      expect(body.includes("\r"), `${path} must use LF line endings`).toBe(false);
      expect(body.startsWith("#!/"), `${path} must begin with shebang`).toBe(true);
    }
  });

  it("does not invoke ambient python3 in fhv-t4-rendered-unit-digests.sh", () => {
    const body = readFileSync(join(ROOT, "scripts/ops/fhv-t4-rendered-unit-digests.sh"), "utf8");
    expect(body).toContain("--python-bin");
    expect(body).not.toMatch(/\bpython3\b/);
  });

  it("mode-only Git changes are limited to the two direct-execution scripts", () => {
    const summary = execFileSync("git", ["diff", "--summary", "origin/dev...HEAD"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    const modeLines = summary
      .split("\n")
      .filter((line) => line.includes(" mode change "))
      .map((line) => line.trim());
    expect(modeLines).toEqual([
      "mode change 100644 => 100755 scripts/ops/fhv-t4-observer-systemd-identity-read.sh",
      "mode change 100644 => 100755 scripts/ops/fhv-t4-rendered-unit-digests.sh",
    ]);
  });

  it("does not require executable Git mode for SSH-stdin bootstrap scripts", () => {
    for (const path of FHV_T4A_SSH_STDIN_SCRIPT_PATHS) {
      const mode = gitLsTreeMode("HEAD", path);
      expect(mode).toMatch(/^100(644|755)$/);
      expect(fhvT4aDirectExecutionScriptPaths()).not.toContain(path);
    }
  });

  it("preserves executable mode when materializing direct-execution scripts from the Git index", () => {
    const checkoutRoot = trackDir("fhv-index-checkout-");
    materializeIndexCheckout(checkoutRoot, fhvT4aDirectExecutionScriptPaths());
    for (const path of fhvT4aDirectExecutionScriptPaths()) {
      const checkedOut = join(checkoutRoot, path);
      expect(existsSync(checkedOut), checkedOut).toBe(true);
      const mode = statSync(checkedOut).mode & 0o777;
      expect(mode & 0o111, `${path} must be executable after index materialization`).not.toBe(0);
    }
  });

  it("executes fhv-t4-rendered-unit-digests.sh directly from index materialization without bash prefix", () => {
    const checkoutRoot = trackDir("fhv-index-digest-");
    materializeIndexCheckout(checkoutRoot, ["scripts/ops/fhv-t4-rendered-unit-digests.sh"]);
    const script = join(checkoutRoot, "scripts/ops/fhv-t4-rendered-unit-digests.sh");
    const rendered = makeRenderedFixture(checkoutRoot);
    const result = spawnSync(script, ["--rendered-dir", rendered, "--python-bin", PYTHON_BIN], {
      encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim()) as Record<string, string>;
    expect(parsed["waia-fhv-campaign.service"]).toHaveLength(64);
    expect(parsed["waia-fhv-observer.service"]).toHaveLength(64);
    expect(parsed["waia-fhv-campaign.service"]).toBe(
      sha256File(join(rendered, "waia-fhv-campaign.service")),
    );
  });

  it("fails closed when rendered units are missing", () => {
    const rendered = trackDir("fhv-rendered-empty-");
    const result = spawnSync(
      "bash",
      [
        join(ROOT, "scripts/ops/fhv-t4-rendered-unit-digests.sh"),
        "--rendered-dir",
        rendered,
        "--python-bin",
        PYTHON_BIN,
      ],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/missing rendered unit/i);
  });

  it("handles rendered paths with spaces via env-safe python heredoc", () => {
    const base = trackDir("fhv-space-path-");
    const rendered = join(base, "rendered units");
    mkdirSync(rendered, { recursive: true });
    writeFileSync(join(rendered, "waia-fhv-campaign.service"), "campaign\n");
    writeFileSync(join(rendered, "waia-fhv-observer.service"), "observer\n");
    const result = spawnSync(
      join(ROOT, "scripts/ops/fhv-t4-rendered-unit-digests.sh"),
      ["--rendered-dir", rendered, "--python-bin", PYTHON_BIN],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      "waia-fhv-campaign.service": sha256File(join(rendered, "waia-fhv-campaign.service")),
      "waia-fhv-observer.service": sha256File(join(rendered, "waia-fhv-observer.service")),
    });
  });

  it("rejects ambient PATH python when an explicit non-executable python-bin is supplied", () => {
    const rendered = makeRenderedFixture(trackDir("fhv-rendered-ambient-"));
    const fakePython = join(trackDir("fhv-fake-python-"), "python3");
    writeFileSync(fakePython, "#!/usr/bin/env bash\necho should-not-run\nexit 9\n");
    chmodSync(fakePython, 0o644);
    const result = spawnSync(
      join(ROOT, "scripts/ops/fhv-t4-rendered-unit-digests.sh"),
      ["--rendered-dir", rendered, "--python-bin", fakePython],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/python-bin required and must be executable/i);
    expect(result.stdout).not.toContain("should-not-run");
  });

  it("Step 11 hermetic executor invokes digests with --python-bin before deploy record", () => {
    const targetSha = "d".repeat(40);
    const { bindings, transport } = createHermeticFixture(targetSha);
    const ctx = buildFhvT4aExecContext({ ...bindings, targetSha }, transport);
    transport.resetRemoteWrites();

    const stepResult = executeFhvT4aStep(ctx, 11);
    expect(stepResult.classification).toBe("FHV_T4A_STEP_11_OK");
    const commands = transport.sshInvocations().map((invocation) => invocation.remoteCommand);
    const digestCmd = commands.find((cmd) => cmd.includes("fhv-t4-rendered-unit-digests.sh"));
    expect(digestCmd).toBeDefined();
    expect(digestCmd).toContain("--python-bin");
    expect(digestCmd).toContain("--rendered-dir");
    expect(digestCmd).not.toMatch(/\/bin\/bash.*fhv-t4-rendered-unit-digests/);
    const deployCmd = commands.find((cmd) => cmd.includes("fhv-systemd-record-deploy.sh"));
    expect(deployCmd).toContain("--rendered-unit-digests");
    expect(deployCmd).toContain("--confirm");
  });

  it("Step 11 hermetic path fails closed when digests command would fail", () => {
    const targetSha = "e".repeat(40);
    const { bindings, transport: baseTransport } = createHermeticFixture(targetSha);
    const transport = {
      ...baseTransport,
      ssh(input: Parameters<FhvT4aOperatorTransport["ssh"]>[0]) {
        if (/fhv-t4-rendered-unit-digests\.sh/.test(input.remoteCommand)) {
          return { exitCode: 2, stdout: "", stderr: "rendered unit digests failed" };
        }
        return baseTransport.ssh(input);
      },
    } satisfies FhvT4aOperatorTransport;
    const ctx = buildFhvT4aExecContext(
      { ...bindings, targetSha, runId: "fhv-t4a-step11-fail-test" },
      transport,
    );
    expect(() => executeFhvT4aStep(ctx, 11)).toThrow(/rendered unit digests failed/);
  });

  it("documents residual installed units as safe for a future fresh run (install-units overwrites)", () => {
    const installScript = readFileSync(
      join(ROOT, "scripts/ops/fhv-supervisor/install-units.sh"),
      "utf8",
    );
    expect(installScript).toMatch(/capture_snapshot/);
    expect(installScript).toMatch(/install_units_transaction/);
    expect(installScript).not.toMatch(/refuse.*already installed/i);
  });

  it("passes bash -n on fhv-t4-rendered-unit-digests.sh", () => {
    execFileSync("bash", ["-n", join(ROOT, "scripts/ops/fhv-t4-rendered-unit-digests.sh")], {
      stdio: "pipe",
    });
  });
});

const linuxDescribe = process.platform === "linux" ? describe : describe.skip;

linuxDescribe("fhv-t4a linux clean checkout rehearsal (PR #431 audit)", () => {
  it("preserves executable bits through git archive checkout on Linux", () => {
    const archiveRoot = trackDir("fhv-linux-archive-");
    gitArchiveCheckout("HEAD", archiveRoot);
    for (const path of fhvT4aDirectExecutionScriptPaths()) {
      const checkedOut = join(archiveRoot, path);
      expect(existsSync(checkedOut), checkedOut).toBe(true);
      expect(statSync(checkedOut).mode & 0o111).not.toBe(0);
    }
  });

  it("executes Step 11 digest command under sudo with minimal PATH", () => {
    const archiveRoot = trackDir("fhv-linux-sudo-digest-");
    gitArchiveCheckout("HEAD", archiveRoot);
    const script = join(archiveRoot, "scripts/ops/fhv-t4-rendered-unit-digests.sh");
    const rendered = makeRenderedFixture(archiveRoot);
    const pythonPath =
      execFileSync("command", ["-v", "python3"], { encoding: "utf8" }).trim() || "/usr/bin/python3";
    const result = spawnSync(
      "sudo",
      ["-n", script, "--rendered-dir", rendered, "--python-bin", pythonPath],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: "/usr/bin:/bin" },
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      "waia-fhv-campaign.service": sha256File(join(rendered, "waia-fhv-campaign.service")),
      "waia-fhv-observer.service": sha256File(join(rendered, "waia-fhv-observer.service")),
    });
  });

  it("executes observer identity script as a direct path without 126/127", () => {
    const archiveRoot = trackDir("fhv-linux-observer-");
    gitArchiveCheckout("HEAD", archiveRoot);
    const script = join(archiveRoot, "scripts/ops/fhv-t4-observer-systemd-identity-read.sh");
    const mockBin = trackDir("fhv-linux-mock-bin-");
    writeFileSync(
      join(mockBin, "systemctl"),
      `#!/usr/bin/env bash
if [[ "$1" == "show" ]]; then
  echo "inactive"
  exit 0
fi
exit 0
`,
    );
    chmodSync(join(mockBin, "systemctl"), 0o755);
    const pythonPath =
      execFileSync("command", ["-v", "python3"], { encoding: "utf8" }).trim() || "/usr/bin/python3";
    const result = spawnSync(
      script,
      [
        "--systemctl-bin",
        join(mockBin, "systemctl"),
        "--python-bin",
        pythonPath,
        "waia-fhv-observer.service",
      ],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(126);
    expect(result.status).not.toBe(127);
    expect(result.stdout.trim()).toContain("fhv-t4-observer-systemd-identity/v1");
  });

  it("loads every direct script via kernel exec without bash prefix (help or usage path)", () => {
    const archiveRoot = trackDir("fhv-linux-direct-load-");
    gitArchiveCheckout("HEAD", archiveRoot);
    for (const path of fhvT4aDirectExecutionScriptPaths()) {
      const script = join(archiveRoot, path);
      const result = spawnSync(script, ["--help"], { encoding: "utf8" });
      expect(result.status, `${path} direct --help`).not.toBe(126);
      expect(result.status, `${path} direct --help`).not.toBe(127);
    }
  });
});
