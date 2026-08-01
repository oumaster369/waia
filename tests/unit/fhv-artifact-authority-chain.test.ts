/**
 * DEE-436 — FHV artifact authority chain negative proofs.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
  assertFhvAuthorizationReceiptForExecution,
  assertFhvConfigurationFreezeForExecution,
  assertFhvControlReplayReceiptForAuthorization,
  assertFhvDatasetQualificationReceiptForExecution,
  FhvArtifactAuthorityError,
} from "@/lib/trader/observability/fhv-artifact-authority-chain";
import { readFhvControlReplayReceipt } from "@/lib/trader/observability/fhv-control-replay-receipt";
import {
  FHV_TEST_RELEASE_SHA,
  FHV_TEST_RELEASE_TAG,
  setupFhvBoundedLaunchArtifacts,
  setupFhvOfficialSchemaLaunchArtifacts,
} from "@/tests/helpers/fhv-official-path-test-fixtures";

const ORG_ID = "00000000-0000-4000-8000-000000000436";
const OPERATOR_ID = "fhv-authority-chain-operator";
const WRONG_SHA = "cccccccccccccccccccccccccccccccccccccccc";

function expectAuthorityError(fn: () => unknown, codePattern: RegExp): void {
  try {
    fn();
    expect.fail("expected FhvArtifactAuthorityError");
  } catch (error) {
    expect(error).toBeInstanceOf(FhvArtifactAuthorityError);
    expect((error as FhvArtifactAuthorityError).code).toMatch(codePattern);
  }
}

describe("DEE-436 FHV artifact authority chain negatives", () => {
  it("rejects qualification releaseSha mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-qual-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-qual",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      expectAuthorityError(
        () =>
          assertFhvDatasetQualificationReceiptForExecution({
            receiptPath: prep.qualificationReceiptPath,
            identity: {
              releaseSha: WRONG_SHA,
              releaseTag: FHV_TEST_RELEASE_TAG,
              organizationId: ORG_ID,
              operatorId: OPERATOR_ID,
            },
          }),
        /RELEASE_SHA_MISMATCH/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects freeze dataset digest mismatch against qualification receipt", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-freeze-"));
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-freeze",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const qualification = assertFhvDatasetQualificationReceiptForExecution({
        receiptPath: prep.qualificationReceiptPath,
        identity: {
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
        },
      });
      expectAuthorityError(
        () =>
          assertFhvConfigurationFreezeForExecution({
            freezePath: prep.configurationFreezePath,
            identity: {
              releaseSha: FHV_TEST_RELEASE_SHA,
              releaseTag: FHV_TEST_RELEASE_TAG,
              organizationId: ORG_ID,
              operatorId: OPERATOR_ID,
            },
            runId: "wrong-run-id",
            qualificationReceipt: qualification,
          }),
        /FREEZE_RUN_ID_MISMATCH/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects control replay qualification digest mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-cr-"));
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-cr",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const qualification = assertFhvDatasetQualificationReceiptForExecution({
        receiptPath: prep.qualificationReceiptPath,
        identity: {
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
        },
      });
      const tamperedQualification = {
        ...qualification,
        qualificationReceiptDigest: "f".repeat(64),
      };
      expectAuthorityError(
        () =>
          assertFhvControlReplayReceiptForAuthorization({
            receiptPath: prep.controlReplayReceiptPath,
            identity: {
              releaseSha: FHV_TEST_RELEASE_SHA,
              releaseTag: FHV_TEST_RELEASE_TAG,
              organizationId: ORG_ID,
              operatorId: OPERATOR_ID,
            },
            qualificationReceipt: tamperedQualification,
          }),
        /QUALIFICATION_DIGEST_MISMATCH/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects authorization freeze digest mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-authz-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-authz",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const qualification = assertFhvDatasetQualificationReceiptForExecution({
        receiptPath: prep.qualificationReceiptPath,
        identity: {
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
        },
      });
      expectAuthorityError(
        () =>
          assertFhvAuthorizationReceiptForExecution({
            receiptPath: prep.authorizationReceiptPath,
            identity: {
              releaseSha: FHV_TEST_RELEASE_SHA,
              releaseTag: FHV_TEST_RELEASE_TAG,
              organizationId: ORG_ID,
              operatorId: OPERATOR_ID,
            },
            runId: "fhv-auth-authz",
            qualificationReceipt: qualification,
            freezeDigest: "0".repeat(64),
          }),
        /FREEZE_DIGEST_MISMATCH/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects authorization organizationId mismatch", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-org-"));
    try {
      const prep = setupFhvBoundedLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-org",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const qualification = assertFhvDatasetQualificationReceiptForExecution({
        receiptPath: prep.qualificationReceiptPath,
        identity: {
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
        },
      });
      const freeze = assertFhvConfigurationFreezeForExecution({
        freezePath: prep.configurationFreezePath,
        identity: {
          releaseSha: FHV_TEST_RELEASE_SHA,
          releaseTag: FHV_TEST_RELEASE_TAG,
          organizationId: ORG_ID,
          operatorId: OPERATOR_ID,
        },
        runId: "fhv-auth-org",
        qualificationReceipt: qualification,
      });
      expectAuthorityError(
        () =>
          assertFhvAuthorizationReceiptForExecution({
            receiptPath: prep.authorizationReceiptPath,
            identity: {
              releaseSha: FHV_TEST_RELEASE_SHA,
              releaseTag: FHV_TEST_RELEASE_TAG,
              organizationId: "00000000-0000-4000-8000-000000000999",
              operatorId: OPERATOR_ID,
            },
            runId: "fhv-auth-org",
            qualificationReceipt: qualification,
            freezeDigest: freeze.configurationFreeze.configurationFreezeDigest,
          }),
        /ORGANIZATION_ID_MISMATCH/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("passes complete authority chain for matching ceremony artifacts", () => {
    const root = mkdtempSync(join(tmpdir(), "fhv-auth-pass-"));
    try {
      const prep = setupFhvOfficialSchemaLaunchArtifacts({
        artifactRoot: root,
        runId: "fhv-auth-pass",
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      });
      const identity = {
        releaseSha: FHV_TEST_RELEASE_SHA,
        releaseTag: FHV_TEST_RELEASE_TAG,
        organizationId: ORG_ID,
        operatorId: OPERATOR_ID,
      };
      const qualification = assertFhvDatasetQualificationReceiptForExecution({
        receiptPath: prep.qualificationReceiptPath,
        identity,
      });
      const freeze = assertFhvConfigurationFreezeForExecution({
        freezePath: prep.configurationFreezePath,
        identity,
        runId: "fhv-auth-pass",
        qualificationReceipt: qualification,
      });
      const controlReplay = assertFhvControlReplayReceiptForAuthorization({
        receiptPath: prep.controlReplayReceiptPath,
        identity,
        qualificationReceipt: qualification,
      });
      expect(readFhvControlReplayReceipt(prep.controlReplayReceiptPath).digestsMatch).toBe(true);
      expect(controlReplay.controlReplayReceiptDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(freeze.configurationFreeze.configurationFreezeDigest).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
