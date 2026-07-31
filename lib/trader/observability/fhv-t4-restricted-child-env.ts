/**
 * DEE-436 — deterministic restricted PATH for T4 continuity identity shell readers.
 *
 * Identity read scripts use `#!/usr/bin/env bash` and qualified-host utilities under
 * `/usr/bin` and `/bin`. Callers must not inherit ambient PATH or use PATH="".
 */

/** Governed Linux Execution Server utility PATH for repository identity shell scripts. */
export const FHV_T4_RESTRICTED_CHILD_PATH = "/usr/bin:/bin" as const;

/**
 * Build a child-process environment for identity shell scripts.
 * Preserves explicit injected bindings while replacing PATH with the restricted constant.
 */
export function buildFhvT4RestrictedChildEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: FHV_T4_RESTRICTED_CHILD_PATH,
  };
}
