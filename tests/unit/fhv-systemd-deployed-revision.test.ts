import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  FhvSystemdDeployedRevisionError,
  FHV_SYSTEMD_DEPLOYED_REVISION_FILENAME,
  FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE,
  FHV_SYSTEMD_LEGACY_CONTAINER_NAME,
  previewFhvSystemdDeployedRevision,
  readFhvSystemdDeployedRevision,
  resolveFhvSystemdDeployedRevisionPath,
  verifyFhvSystemdDeployedRevisionMatchesTarget,
  verifyFhvSystemdDeployedRevisionRecord,
  writeFhvSystemdDeployedRevisionAtomic,
  type FhvSystemdDeployedRevisionInput,
} from "@/lib/trader/observability/fhv-systemd-deployed-revision";
import {
  FHV_SYSTEMD_CAMPAIGN_UNIT,
  FHV_SYSTEMD_OBSERVER_UNIT,
} from "@/lib/trader/observability/fhv-systemd-unit-config";

const TARGET_SHA = "abababababababababababababababababababab";
const OTHER_SHA = "bcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbcbc";
const RUN_ID = "fhv-systemd-record-test";
const ORG_ID = "00000000-0000-4000-8000-000000000435";
const RELEASE_TAG = "v2026.07.24.test435";
const SERVICE_USER = "waia-fhv";
const UNIT_DIGESTS = {
  [FHV_SYSTEMD_CAMPAIGN_UNIT]: "a".repeat(64),
  [FHV_SYSTEMD_OBSERVER_UNIT]: "b".repeat(64),
} as const;

function sampleInput(
  overrides: Partial<FhvSystemdDeployedRevisionInput> = {},
): FhvSystemdDeployedRevisionInput {
  return {
    releaseSha: TARGET_SHA,
    releaseTag: RELEASE_TAG,
    runId: RUN_ID,
    organizationId: ORG_ID,
    renderedUnitDigests: UNIT_DIGESTS,
    installedAtUtc: "2026-07-24T12:00:00.000Z",
    operatorId: "operator-preview",
    serviceUser: SERVICE_USER,
    legacyContainerRunning: true,
    ...overrides,
  };
}

describe("fhv-systemd-deployed-revision (DEE-435)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("previews record without writing", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-preview-"));
    const preview = previewFhvSystemdDeployedRevision(sampleInput());
    expect(preview.releaseSha).toBe(TARGET_SHA);
    expect(preview.legacyContainerName).toBe(FHV_SYSTEMD_LEGACY_CONTAINER_NAME);
    expect(preview.legacyContainerImage).toBe(FHV_SYSTEMD_LEGACY_CONTAINER_IMAGE);
    expect(preview.deploymentKind).toBe("FHV_SYSTEMD_REHEARSAL");
    expect(existsSync(resolveFhvSystemdDeployedRevisionPath(root))).toBe(false);
  });

  it("writes record atomically on confirm path", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-confirm-"));
    const record = writeFhvSystemdDeployedRevisionAtomic(
      root,
      sampleInput({ operatorId: "operator-confirm" }),
    );
    const path = resolveFhvSystemdDeployedRevisionPath(root);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain(
      FHV_SYSTEMD_DEPLOYED_REVISION_FILENAME.slice(0, 10),
    );
    expect(readFhvSystemdDeployedRevision(root)?.releaseSha).toBe(TARGET_SHA);
    expect(record.contentDigest).toBe(readFhvSystemdDeployedRevision(root)?.contentDigest);
  });

  it("surfaces atomic write failures without partial final file", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-atomic-fail-"));
    const path = resolveFhvSystemdDeployedRevisionPath(root);
    expect(() =>
      writeFhvSystemdDeployedRevisionAtomic(root, sampleInput({ operatorId: "operator-fail" }), {
        writeAtomic: () => {
          throw new Error("atomic write failed");
        },
      }),
    ).toThrow("atomic write failed");
    expect(existsSync(path)).toBe(false);
  });

  it("verifier rejects missing record", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-missing-"));
    expect(() =>
      verifyFhvSystemdDeployedRevisionMatchesTarget({ repoRoot: root, targetSha: TARGET_SHA }),
    ).toThrow(FhvSystemdDeployedRevisionError);
    try {
      verifyFhvSystemdDeployedRevisionMatchesTarget({ repoRoot: root, targetSha: TARGET_SHA });
    } catch (error) {
      expect((error as FhvSystemdDeployedRevisionError).code).toBe("FHV_SYSTEMD_REVISION_MISSING");
    }
  });

  it("verifier rejects sha mismatch", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-mismatch-"));
    writeFhvSystemdDeployedRevisionAtomic(root, sampleInput({ releaseSha: OTHER_SHA }));
    expect(() =>
      verifyFhvSystemdDeployedRevisionMatchesTarget({ repoRoot: root, targetSha: TARGET_SHA }),
    ).toThrow(FhvSystemdDeployedRevisionError);
  });

  it("verifier rejects release tag mismatch", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-tag-"));
    writeFhvSystemdDeployedRevisionAtomic(root, sampleInput());
    expect(() =>
      verifyFhvSystemdDeployedRevisionMatchesTarget({
        repoRoot: root,
        targetSha: TARGET_SHA,
        releaseTag: "wrong-tag",
      }),
    ).toThrow(FhvSystemdDeployedRevisionError);
  });

  it("verifier rejects rendered unit digest mismatch", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-digest-"));
    writeFhvSystemdDeployedRevisionAtomic(root, sampleInput());
    expect(() =>
      verifyFhvSystemdDeployedRevisionMatchesTarget({
        repoRoot: root,
        targetSha: TARGET_SHA,
        renderedUnitDigests: {
          [FHV_SYSTEMD_CAMPAIGN_UNIT]: "c".repeat(64),
          [FHV_SYSTEMD_OBSERVER_UNIT]: UNIT_DIGESTS[FHV_SYSTEMD_OBSERVER_UNIT],
        },
      }),
    ).toThrow(FhvSystemdDeployedRevisionError);
  });

  it("verifier rejects malformed partial record", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-partial-"));
    const path = resolveFhvSystemdDeployedRevisionPath(root);
    mkdirSync(join(root, ".ops"), { recursive: true });
    writeFileSync(
      path,
      '{"schemaVersion":"fhv-systemd-deployed-revision/v1","releaseSha":"',
      "utf8",
    );
    expect(() => readFhvSystemdDeployedRevision(root)).toThrow();
  });

  it("verifier rejects content digest mismatch", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-systemd-content-"));
    writeFhvSystemdDeployedRevisionAtomic(root, sampleInput());
    const path = resolveFhvSystemdDeployedRevisionPath(root);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    parsed.contentDigest = "0".repeat(64);
    writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    expect(() => verifyFhvSystemdDeployedRevisionRecord(parsed as never)).toThrow(
      FhvSystemdDeployedRevisionError,
    );
  });
});
