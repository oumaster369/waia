import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  buildFhvRehearsalLaunchConfig,
  FhvRehearsalLaunchError,
  FHV_REHEARSAL_MAX_RUNTIME_MS,
  materializeFhvRehearsalManifest,
  resolveFhvRehearsalAlertPolicyDigest,
  resolveFhvRehearsalRunDirectory,
  validateFhvRehearsalManifestAtRuntime,
  type FhvRehearsalLaunchConfigV1,
} from "@/lib/trader/observability/fhv-rehearsal-launcher";

const TARGET_SHA = "dddddddddddddddddddddddddddddddddddddddd";
const RUN_ID = "fhv-manifest-test";
const ORG_ID = "00000000-0000-4000-8000-000000000416";

function validManifest(
  overrides: Partial<FhvRehearsalLaunchConfigV1> = {},
): FhvRehearsalLaunchConfigV1 {
  return {
    schemaVersion: "fhv-rehearsal-launch/v1",
    fixtureId: "HTR_WP03_BENCHMARK",
    targetSha: TARGET_SHA,
    runId: RUN_ID,
    organizationId: ORG_ID,
    artifactRoot: "/tmp/fhv-artifacts",
    alertPolicyDigest: resolveFhvRehearsalAlertPolicyDigest(),
    maxRuntimeMs: FHV_REHEARSAL_MAX_RUNTIME_MS,
    ...overrides,
  };
}

describe("FHV rehearsal manifest runtime validation (DEE-431)", () => {
  it("accepts a materialized manifest at the canonical run root", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-manifest-ok-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: RUN_ID,
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const { runDir } = materializeFhvRehearsalManifest(config);
      expect(validateFhvRehearsalManifestAtRuntime({ runRoot: runDir }).runId).toBe(RUN_ID);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  const negativeCases: Array<{ name: string; mutate: (m: FhvRehearsalLaunchConfigV1) => unknown }> =
    [
      {
        name: "invalid JSON object",
        mutate: () => "not-an-object",
      },
      {
        name: "schemaVersion mismatch",
        mutate: (m) => ({ ...m, schemaVersion: "other/v1" }),
      },
      {
        name: "unknown field",
        mutate: (m) => ({ ...m, evil: true }),
      },
      {
        name: "missing runId",
        mutate: (m) => {
          const { runId: _runId, ...rest } = m;
          return rest;
        },
      },
      {
        name: "fixture not allowlisted",
        mutate: (m) => ({ ...m, fixtureId: "EVIL_FIXTURE" }),
      },
      {
        name: "abbreviated targetSha",
        mutate: (m) => ({ ...m, targetSha: "abc123" }),
      },
      {
        name: "invalid organizationId",
        mutate: (m) => ({ ...m, organizationId: "not-a-uuid" }),
      },
      {
        name: "unsafe artifactRoot",
        mutate: (m) => ({ ...m, artifactRoot: "/tmp/evil path" }),
      },
      {
        name: "run root mismatch",
        mutate: (m) => m,
      },
      {
        name: "tampered alertPolicyDigest",
        mutate: (m) => ({ ...m, alertPolicyDigest: "0".repeat(64) }),
      },
      {
        name: "maxRuntimeMs above bound",
        mutate: (m) => ({ ...m, maxRuntimeMs: FHV_REHEARSAL_MAX_RUNTIME_MS + 1 }),
      },
      {
        name: "maxRuntimeMs zero",
        mutate: (m) => ({ ...m, maxRuntimeMs: 0 }),
      },
    ];

  it.each(negativeCases.filter((c) => c.name !== "run root mismatch"))(
    "rejects $name",
    ({ mutate }) => {
      const runRoot = resolveFhvRehearsalRunDirectory("/tmp/fhv-artifacts", RUN_ID);
      try {
        validateFhvRehearsalManifestAtRuntime({ runRoot, raw: mutate(validManifest()) });
        expect.fail("expected manifest validation throw");
      } catch (error) {
        expect(error).toBeInstanceOf(FhvRehearsalLaunchError);
      }
    },
  );

  it("rejects runRoot mismatch against artifactRoot canonical path", () => {
    const manifest = validManifest();
    expect(() =>
      validateFhvRehearsalManifestAtRuntime({
        runRoot: "/tmp/wrong/run/root",
        raw: manifest,
      }),
    ).toThrow(/RUN_ROOT_MISMATCH|runRoot does not match/);
  });

  it("rejects malformed JSON on disk", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-manifest-json-"));
    try {
      const config = buildFhvRehearsalLaunchConfig({
        fixtureId: "HTR_WP03_BENCHMARK",
        targetSha: TARGET_SHA,
        runId: "json-bad",
        organizationId: ORG_ID,
        artifactRoot: root,
      });
      const { runDir } = materializeFhvRehearsalManifest(config);
      writeFileSync(join(runDir, "fhv-rehearsal-manifest.v1.json"), "{not json", "utf8");
      try {
        validateFhvRehearsalManifestAtRuntime({ runRoot: runDir });
        expect.fail("expected invalid json throw");
      } catch (error) {
        expect(error).toBeInstanceOf(FhvRehearsalLaunchError);
        expect((error as FhvRehearsalLaunchError).code).toBe("MANIFEST_INVALID_JSON");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
