/**
 * HTR-WP21 — fail-closed proof that canonical Vitest does not load repository `.env.local`.
 */

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const HERMETIC_ENV_DIR = path.join(REPO_ROOT, "tests/env/vitest-hermetic");
const EXPLICIT_PROBE_KEY = "HTR_WP21_HERMETIC_EXPLICIT_PROBE";

function minimalSubprocessEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    NODE_ENV: "test",
    ...extra,
  };
}

describe("vitest hermetic environment proof (HTR-WP21)", () => {
  it("uses an empty dedicated envDir without repository dotenv files", () => {
    const hermeticEntries = readdirSync(HERMETIC_ENV_DIR);
    expect(hermeticEntries.some((entry) => entry.startsWith(".env"))).toBe(false);
  });

  it("proves default Vitest subprocess is hermetic from repository dotenv", () => {
    const out = execFileSync(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "tests/unit/vitest-hermetic-environment-probe.test.ts",
        "--reporter=dot",
      ],
      {
        cwd: REPO_ROOT,
        env: minimalSubprocessEnv(),
        encoding: "utf8",
      },
    );
    expect(out).toContain("hermetic-ok");
  });

  it("preserves explicitly supplied process.env in a child process", () => {
    const probeValue = "explicit-child-probe";
    const script = `
      if (process.env.${EXPLICIT_PROBE_KEY} !== ${JSON.stringify(probeValue)}) {
        process.exit(2);
      }
      process.stdout.write("ok");
    `;
    const out = execFileSync(process.execPath, ["-e", script], {
      env: minimalSubprocessEnv({ [EXPLICIT_PROBE_KEY]: probeValue }),
      encoding: "utf8",
    });
    expect(out).toBe("ok");
  });
});

export const DEFAULT_VITEST_ENV_PROFILE = "HERMETIC" as const;
export const REPOSITORY_DOTENV_LOCAL_LOADED = false as const;
export const EXPLICIT_PROCESS_ENV_PRESERVED = true as const;
