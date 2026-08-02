/**
 * Phase 14 — public ceremony packets must document resume flows and governance rules.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readPacket(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), "utf8");
}

describe("FHV public ceremony packet resume contract (Phase 14)", () => {
  const fullLaunch = readPacket("docs/ops/FHV-FULL-HISTORICAL-LAUNCH-PACKET.md");
  const controlReplay = readPacket("docs/ops/FHV-CONTROL-REPLAY-PACKET.md");
  const validatorSource = readFileSync(
    join(ROOT, "scripts/ops/validate-fhv-public-ceremony-packets.ts"),
    "utf8",
  );

  it("full launch packet documents executionPurpose, run, and resume", () => {
    expect(fullLaunch).toContain("executionPurpose=FULL_HISTORICAL");
    expect(fullLaunch).toContain("pnpm trader:fhv:run");
    expect(fullLaunch).toContain("pnpm trader:fhv:run -- --resume");
  });

  it("full launch packet documents required terminal classifications", () => {
    const classifications = [
      "FULL_HISTORICAL_TECHNICAL_COMPLETION",
      "FULL_HISTORICAL_ECONOMIC_STOP_TECHNICAL_COMPLETION",
      "FULL_HISTORICAL_INFRASTRUCTURE_FAILURE",
      "FHV_SYNTHETIC_SCALE_PROBE_COMPLETED",
      "FHV_SYNTHETIC_PROCESS_PARITY_SEGMENT_COMPLETED",
      "FHV_SYNTHETIC_PROCESS_PARITY_PAUSED",
      "FHV_SCHEMA_INTEGRATION_CEREMONY_PASS",
    ];
    for (const classification of classifications) {
      expect(fullLaunch, classification).toContain(classification);
    }
  });

  it("full launch packet must not require FULL_HISTORICAL_VALIDATION_COMPLETED", () => {
    expect(fullLaunch).not.toMatch(/^\|\s*`FULL_HISTORICAL_VALIDATION_COMPLETED`/m);
    expect(fullLaunch).not.toMatch(/^-\s*`FULL_HISTORICAL_VALIDATION_COMPLETED`/m);
    expect(fullLaunch).toMatch(/\*\*not\*\* required by the public ceremony packet/);
  });

  it("full launch packet documents resume governance rules", () => {
    const rules = [
      "authorization consumed exactly once",
      "generation takeover",
      "stale-generation rejection",
      "terminal reconciliation",
      "refusal to resume a completed run",
    ];
    for (const rule of rules) {
      expect(fullLaunch, rule).toContain(rule);
    }
  });

  it("control replay packet documents executionPurpose, control-replay, and resume", () => {
    expect(controlReplay).toContain("executionPurpose=CONTROL_REPLAY");
    expect(controlReplay).toContain("pnpm trader:fhv:control-replay");
    expect(controlReplay).toContain("pnpm trader:fhv:control-replay -- --resume");
  });

  it("control replay packet documents resume governance rules", () => {
    const rules = [
      "authorization consumed exactly once",
      "generation takeover",
      "stale-generation rejection",
      "terminal reconciliation",
      "refusal to resume a completed run",
    ];
    for (const rule of rules) {
      expect(controlReplay, rule).toContain(rule);
    }
  });

  it("validator assertFullLaunchPacket enforces resume and classification contract", () => {
    expect(validatorSource).toContain("assertFullLaunchPacket");
    expect(validatorSource).toContain("pnpm trader:fhv:run -- --resume");
    expect(validatorSource).toContain("FULL_HISTORICAL_TECHNICAL_COMPLETION");
    expect(validatorSource).toContain("FHV_SYNTHETIC_SCALE_PROBE_COMPLETED");
    expect(validatorSource).toMatch(
      /must not require FULL_HISTORICAL_VALIDATION_COMPLETED|must not require FULL_HISTORICAL_VALIDATION_COMPLETED as a gate terminal class/,
    );
  });

  it("validator assertControlReplayPacket enforces resume contract", () => {
    expect(validatorSource).toContain("assertControlReplayPacket");
    expect(validatorSource).toContain("pnpm trader:fhv:control-replay -- --resume");
    expect(validatorSource).toContain("assertResumeGovernance");
  });

  it("package.json exposes validate:fhv-public-ceremony-packets script", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["validate:fhv-public-ceremony-packets"]).toContain(
      "validate-fhv-public-ceremony-packets.ts",
    );
  });
});
