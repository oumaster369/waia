import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admission = readFileSync(
  "lib/trader/research/execopp-qualification/historical-four-surface-ratified-admission-v2.ts",
  "utf8",
);
const resolverApi = readFileSync(
  "lib/trader/historical-simulation-v2/scientific-evidence-resolver-v1.ts",
  "utf8",
);
const resolverImpl = readFileSync("scripts/trader/scientific-evidence-resolver-v1.ts", "utf8");
const operator = readFileSync("scripts/ops/historical-finalize-only-v1.mjs", "utf8");

describe("DEE-1004 strict resolver launch wiring", () => {
  it("binds a builder-free resolve API and never falls back to get-or-build on that API", () => {
    expect(resolverApi).toContain("export function resolveScientificEvidenceV1");
    expect(resolverApi).toContain("export function resolveScientificEvidenceAsyncV1");
    expect(resolverApi).toContain("export function resolveScientificPackageV1");
    expect(resolverApi).not.toMatch(
      /export function resolveScientific(?:Evidence|Package)V1[\s\S]{0,400}build\s*[:=]/,
    );
    expect(resolverImpl).not.toMatch(/\bmkdirSync\(|\bwriteFileSync\(|\bmkdtempSync\(/);
  });

  it("uses the strict resolver for technical preparation and FINALIZATION_REPLAY", () => {
    expect(admission).toContain('observer, "strict-resolve"');
    expect(admission).toContain('scientificEvidenceAccess: "strict-resolve"');
    const replay = admission.indexOf('phase: "FINALIZATION_REPLAY"');
    const replayAccess = admission.indexOf('scientificEvidenceAccess: "strict-resolve"', replay);
    expect(replay).toBeGreaterThan(0);
    expect(replayAccess).toBeGreaterThan(replay);
    expect(admission.indexOf("resolveScientificPackageV1(packageInput)")).toBeGreaterThan(0);
    expect(admission).toContain("resolveScientificEvidenceV1");
    expect(admission).toContain("resolveScientificEvidenceAsyncV1");
    expect(admission).toContain("scientificForecastEvidenceNamespaceV1(surfaceKey)");
    expect(admission).toContain("PREDICTIVE_TERMINAL_CHECKPOINT_STAGE");
  });

  it("keeps the 90de pin path and adds a generic release-binding operator", () => {
    expect(operator).toContain('SCIENTIFIC_RELEASE = "90de233a192f9b97fa2d6a1ab0c3c1ba5a72df67"');
    expect(operator).toContain("SOURCE_FILE_COUNT = 2033");
    expect(operator).toContain("validateManifestBoundInvocation");
    expect(operator).toContain("verifyManifestBoundSource");
    expect(operator).toContain("finalizeWithManifestBoundApi");
    expect(operator).toContain("createStrictScientificEvidenceResolverV1");
    expect(operator).toContain("withStrictScientificResolverV1");
    expect(operator).not.toMatch(/git rev-parse HEAD|origin\/main\b/);
  });
});
