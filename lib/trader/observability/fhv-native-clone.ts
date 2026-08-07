import { enforceServerOnly } from "@/lib/enforce-server-only";

enforceServerOnly();

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Truthful native copy-on-write clone (ADR-0025 AD-6, WP-3B Option E).
 *
 * `copyFileSync(src, dst, COPYFILE_FICLONE)` silently degrades to a full byte copy when the
 * filesystem cannot reflink, so a successful return proved nothing. Measured on APFS: the Node
 * path took 530-556 ms for 1 GiB while `cp -c` cloned the same file in ~0 ms, and
 * `COPYFILE_FICLONE_FORCE` raised ENOSYS because it is a Linux ioctl that libuv does not map to
 * macOS `clonefile`.
 *
 * This module therefore uses the strict platform utility, which fails rather than copying when
 * native clone is unavailable, and only reports success after independently verifying the
 * destination. Clone success is never inferred from a fallback-capable API, the OS name, the
 * filesystem name, or elapsed time.
 */

export type FhvNativeCloneStatus =
  /** Strict native clone proven: the destination exists with a matching size. */
  | "NATIVE_CLONE_SUCCEEDED"
  /** The platform or filesystem cannot reflink; callers use the fused copy+digest fallback. */
  | "NATIVE_CLONE_UNSUPPORTED"
  /** Clone was attempted and failed for another reason; evidence is preserved. */
  | "NATIVE_CLONE_FAILED";

/** Directories proven unable to reflink, so the strict probe is not repeated per checkpoint. */
const unsupportedDirectories = new Map<string, FhvNativeCloneResult>();

/** Test seam: clears cached capability so a suite can exercise both branches. */
export function resetFhvNativeCloneCapabilityCache(): void {
  unsupportedDirectories.clear();
}

export type FhvNativeCloneResult = Readonly<{
  status: FhvNativeCloneStatus;
  reflinkUsed: boolean;
  mechanism: string;
  detail: string;
}>;

/** Strict clone arguments per platform: each fails instead of falling back to a copy. */
function resolveStrictCloneCommand(
  sourcePath: string,
  destPath: string,
): { command: string; args: string[]; mechanism: string } | null {
  if (process.platform === "darwin") {
    // macOS cp -c uses clonefile(2) and errors when cloning is not possible.
    return {
      command: "/bin/cp",
      args: ["-c", sourcePath, destPath],
      mechanism: "darwin:clonefile",
    };
  }
  if (process.platform === "linux") {
    // GNU cp --reflink=always fails when the filesystem cannot reflink (ext4 cannot).
    return {
      command: "cp",
      args: ["--reflink=always", sourcePath, destPath],
      mechanism: "linux:FICLONE",
    };
  }
  return null;
}

/**
 * Attempt a strict native clone.
 *
 * Never leaves a partial destination behind: a failed attempt removes anything it created so the
 * caller's fallback starts from a clean state.
 */
export function tryNativeCloneFile(sourcePath: string, destPath: string): FhvNativeCloneResult {
  if (process.env.FHV_FORCE_CLONE_UNSUPPORTED === "1") {
    // Lets a reflink-capable host exercise the real fallback path that ext4 runners take. This
    // suppresses the clone attempt only; the fallback it forces is the production one.
    return {
      status: "NATIVE_CLONE_UNSUPPORTED",
      reflinkUsed: false,
      mechanism: `${process.platform}:forced-unsupported`,
      detail: "FHV_FORCE_CLONE_UNSUPPORTED=1",
    };
  }
  const resolved = resolveStrictCloneCommand(sourcePath, destPath);
  if (!resolved) {
    return {
      status: "NATIVE_CLONE_UNSUPPORTED",
      reflinkUsed: false,
      mechanism: `${process.platform}:none`,
      detail: `no strict native clone mechanism for platform ${process.platform}`,
    };
  }

  /*
   * Cache per destination directory. The strict mechanism is a subprocess, so on a filesystem that
   * cannot reflink every checkpoint would otherwise pay a spawn that is guaranteed to fail. A
   * filesystem does not gain or lose reflink support during a run, so one probe per directory is
   * sufficient and the fallback path stays free of per-checkpoint process overhead.
   */
  const destDirectory = dirname(destPath);
  const cached = unsupportedDirectories.get(destDirectory);
  if (cached) {
    return { ...cached, mechanism: resolved.mechanism };
  }

  const outcome = spawnSync(resolved.command, resolved.args, { encoding: "utf8" });
  if (outcome.error) {
    rmSync(destPath, { force: true });
    const result: FhvNativeCloneResult = {
      status: "NATIVE_CLONE_UNSUPPORTED",
      reflinkUsed: false,
      mechanism: resolved.mechanism,
      detail: `clone mechanism unavailable: ${outcome.error.message}`,
    };
    unsupportedDirectories.set(destDirectory, result);
    return result;
  }
  if (outcome.status !== 0) {
    rmSync(destPath, { force: true });
    // The strict flag refusing is exactly how an unsupported filesystem reports itself.
    const result: FhvNativeCloneResult = {
      status: "NATIVE_CLONE_UNSUPPORTED",
      reflinkUsed: false,
      mechanism: resolved.mechanism,
      detail: `exit=${outcome.status} stderr=${(outcome.stderr ?? "").trim().slice(0, 200)}`,
    };
    unsupportedDirectories.set(destDirectory, result);
    return result;
  }

  // Verify independently: a zero exit code alone is not proof.
  if (!existsSync(destPath)) {
    return {
      status: "NATIVE_CLONE_FAILED",
      reflinkUsed: false,
      mechanism: resolved.mechanism,
      detail: "clone reported success but destination is absent",
    };
  }
  const sourceBytes = statSync(sourcePath).size;
  const destBytes = statSync(destPath).size;
  if (sourceBytes !== destBytes) {
    rmSync(destPath, { force: true });
    return {
      status: "NATIVE_CLONE_FAILED",
      reflinkUsed: false,
      mechanism: resolved.mechanism,
      detail: `size mismatch source=${sourceBytes} dest=${destBytes}`,
    };
  }

  return {
    status: "NATIVE_CLONE_SUCCEEDED",
    reflinkUsed: true,
    mechanism: resolved.mechanism,
    detail: `cloned ${sourceBytes} bytes`,
  };
}

export type FhvNativeCloneCapability = Readonly<{
  supported: boolean;
  status: FhvNativeCloneStatus;
  mechanism: string;
  detail: string;
  platform: string;
}>;

/**
 * Probe native-clone capability for a directory by cloning a small scratch file.
 *
 * Used by the WP-3B blocking gate and by the future Execution Server preflight to classify the
 * host before qualification, rather than assuming capability from the platform name.
 */
export function probeFhvNativeCloneCapability(input: {
  directory: string;
  writeProbe: (path: string) => void;
}): FhvNativeCloneCapability {
  const probePath = `${input.directory}/.fhv-clone-probe-${process.pid}-${Date.now()}`;
  const clonePath = `${probePath}.clone`;
  try {
    input.writeProbe(probePath);
    const result = tryNativeCloneFile(probePath, clonePath);
    return {
      supported: result.status === "NATIVE_CLONE_SUCCEEDED",
      status: result.status,
      mechanism: result.mechanism,
      detail: result.detail,
      platform: `${process.platform}-${process.arch}`,
    };
  } finally {
    rmSync(probePath, { force: true });
    rmSync(clonePath, { force: true });
  }
}
