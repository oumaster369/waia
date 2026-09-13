// Keep the native Node/process-safety suite in the repository's normal Vitest CI gate.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("passes pinned finalize-only operator Node/source-contract tests", () => {
  const result = spawnSync(process.execPath, ["--test", "tests/unit/historical-finalize-only-operator.test.mjs"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 40_000,
    env: { PATH: process.env.PATH, NODE_ENV: "test" },
  });
  expect(result.error, result.stdout + result.stderr).toBeUndefined();
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, 45_000);
