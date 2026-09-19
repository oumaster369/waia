import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const BUILD = join(process.cwd(), "scripts/ops/execution-server-build.sh");

const LARGE_PRODUCER = `awk 'BEGIN { for (i = 1; i <= 5000; i++) printf "%01024d\\n", i }'`;

function runPipeline(
  consumer: string,
  producer = LARGE_PRODUCER,
): {
  status: number | null;
  stderr: string;
} {
  const result = spawnSync(
    "bash",
    ["-lc", `set -euo pipefail; ${producer} | ${consumer} >/dev/null`],
    { encoding: "utf8" },
  );
  return { status: result.status, stderr: result.stderr };
}

describe("DEE-942 execution-server docker history inspect", () => {
  it("consumes docker history without head(1) so pipefail cannot see SIGPIPE", () => {
    const build = readFileSync(BUILD, "utf8");
    expect(build).not.toMatch(/docker history "\$IMAGE_TAG" \| head -n 20/);
    expect(build).toContain("docker history \"$IMAGE_TAG\" | sed -n '1,20p'");
  });

  it("reproduces SIGPIPE 141 when head closes a producer larger than the pipe buffer", () => {
    const result = runPipeline("head -n 20");
    expect(result.status).toBe(141);
  });

  it("does not return 141 when sed consumes a producer larger than the pipe buffer", () => {
    const result = runPipeline("sed -n '1,20p'");
    expect(result.status).toBe(0);
  });

  it("still propagates a true producer failure through the consuming inspect", () => {
    const result = runPipeline("sed -n '1,20p'", "bash -lc 'echo layer; exit 7'");
    expect(result.status).toBe(7);
  });
});
