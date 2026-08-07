/**
 * Phase 9 — official-scale orchestration order and vitest exclusion contract.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("FHV official-scale orchestration (Phase 9)", () => {
  it("FHV_SCALE_ORCHESTRATION_ORDER: package.json scripts run probe then parity then full-corpus", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    const scripts = pkg.scripts;

    expect(scripts["test:fhv:official-scale:probe"]).toContain(
      "vitest.fhv-official-scale.config.ts",
    );
    expect(scripts["test:fhv:official-scale:probe"]).toContain(
      "fhv-official-throughput-probe.test.ts",
    );
    expect(scripts["test:fhv:official-scale:process-parity"]).toContain(
      "fhv-official-process-crash-resume.test.ts",
    );
    expect(scripts["test:fhv:official-scale:full-corpus"]).toContain(
      "fhv-official-full-corpus.test.ts",
    );

    const orchestrator = scripts["test:fhv:official-scale"];
    expect(orchestrator).toBe(
      "pnpm test:fhv:official-scale:probe && pnpm test:fhv:official-scale:process-parity && pnpm test:fhv:official-scale:full-corpus",
    );
  });

  it("FHV_SCALE_VITEST_EXCLUSION: default vitest.config excludes blocking/**", () => {
    const config = readFileSync(join(process.cwd(), "vitest.config.ts"), "utf8");
    expect(config).toContain("tests/fhv/official-scale/blocking/**");
  });

  it("FHV_SCALE_READER_SCRIPT: reader-only proof remains runnable outside blocking gate", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["test:fhv:official-scale:reader"]).toContain(
      "fhv-official-production-scale.test.ts",
    );
  });
});
