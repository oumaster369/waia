import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  parseFhvT4ObserverQualificationProof,
  parseFhvT4ObserverQualificationProofUnsigned,
  type FhvT4ObserverQualificationIdentityCapture,
  writeFhvT4ObserverQualificationProofAtomic,
} from "@/lib/trader/observability/fhv-t4-observer-qualification-proof";
import { runFhvT4ClosureCli } from "@/scripts/trader/fhv-t4-closure-cli";

const QUAL_BOOT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function captureFixture(
  overrides: Partial<FhvT4ObserverQualificationIdentityCapture> = {},
): FhvT4ObserverQualificationIdentityCapture {
  return {
    unitName: "waia-fhv-observer.service",
    bootId: QUAL_BOOT_ID,
    invocationId: "inv-1",
    mainPid: 100,
    activeEnterTimestampMonotonicUs: "1",
    activeState: "active",
    ...overrides,
  };
}

describe("observer qualification single serialization (DEE-436 E-01)", () => {
  let root = "";

  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
      root = "";
    }
  });

  it("rejects unsigned payload containing contentDigest", () => {
    expect(() =>
      parseFhvT4ObserverQualificationProofUnsigned({
        schemaVersion: "fhv-t4-observer-qualification-proof/v1",
        phase: "PRE_CAMPAIGN",
        runId: "run",
        organizationId: "00000000-0000-4000-8000-000000000001",
        targetSha: "a".repeat(40),
        bootId: QUAL_BOOT_ID,
        unitName: "waia-fhv-observer.service",
        identityBeforeCapture: captureFixture(),
        identityAfterCapture: captureFixture(),
        statusDigest: "abc",
        capturedAtUtc: new Date().toISOString(),
        contentDigest: "deadbeef",
      }),
    ).toThrow(/contentDigest|QUALIFICATION_DOUBLE_SERIALIZATION/);
  });

  it("writes through closure CLI then parses written file", async () => {
    root = mkdtempSync(join(tmpdir(), "fhv-qual-write-"));
    const runRoot = join(root, "run");
    const output = join(runRoot, "control/fhv-t4-observer-qualification-pre-campaign.v1.json");
    const unsigned = {
      schemaVersion: "fhv-t4-observer-qualification-proof/v1",
      phase: "PRE_CAMPAIGN",
      runId: "run",
      organizationId: "00000000-0000-4000-8000-000000000001",
      targetSha: "a".repeat(40),
      bootId: QUAL_BOOT_ID,
      unitName: "waia-fhv-observer.service",
      identityBeforeCapture: captureFixture(),
      identityAfterCapture: captureFixture(),
      statusDigest: "abc123",
      capturedAtUtc: new Date().toISOString(),
    };
    const result = await runFhvT4ClosureCli({
      subcommand: "write-observer-qualification-proof",
      runRoot,
      runId: "run",
      organizationId: "00000000-0000-4000-8000-000000000001",
      targetSha: "a".repeat(40),
      releaseTag: "local-dev",
      repoRoot: root,
      renderedUnitsDir: join(runRoot, "rendered"),
      installedUnitsDir: "/etc/systemd/system",
      sealDestination: join(runRoot, "seal"),
      serviceUser: "fhv",
      operatorId: "operator",
      workingDirectory: root,
      environmentFile: join(root, "fhv.env"),
      continuityBeforePath: "",
      continuityAfterPath: "",
      hostProbeJsonPath: "",
      postRollbackHostProbeJsonPath: "",
      rawHostProbeJsonPath: "",
      hostProbePhase: "DEPLOYMENT",
      observerQualificationPhase: "PRE_CAMPAIGN",
      observerQualificationProofJson: JSON.stringify(unsigned),
      outputPath: output,
      timeoutMs: null,
      rawHostProbeJson: "",
    });
    expect(result.exitCode).toBe(0);
    const written = parseFhvT4ObserverQualificationProof(JSON.parse(readFileSync(output, "utf8")));
    expect(written.phase).toBe("PRE_CAMPAIGN");
    expect(written.statusDigest).toBe("abc123");
  });

  it("atomic writer produces parseable proof", () => {
    root = mkdtempSync(join(tmpdir(), "fhv-qual-atomic-"));
    const output = join(root, "proof.json");
    const proof = writeFhvT4ObserverQualificationProofAtomic(output, {
      schemaVersion: "fhv-t4-observer-qualification-proof/v1",
      phase: "PRE_CAMPAIGN",
      runId: "run",
      organizationId: "00000000-0000-4000-8000-000000000001",
      targetSha: "a".repeat(40),
      bootId: QUAL_BOOT_ID,
      unitName: "waia-fhv-observer.service",
      identityBeforeCapture: captureFixture(),
      identityAfterCapture: captureFixture(),
      statusDigest: "abc123",
      capturedAtUtc: new Date().toISOString(),
    });
    expect(parseFhvT4ObserverQualificationProof(JSON.parse(readFileSync(output, "utf8")))).toEqual(
      proof,
    );
  });
});
