import { describe, expect, it } from "vitest";

import {
  classifyFhvT4aResidualUnitIdentity,
  fhvT4aResidualRecoveryBeforeStateDigest,
} from "@/lib/trader/observability/fhv-t4-residual-unit-identity";

const FAILED_RUN = "fhv-t4a-20260727t125110z-03d2b13";
const FAILED_SHA = "03d2b1311b4e01bd469f6393bdde0c8aafab7da5";
const ORG = "00000000-0000-4000-8000-000000000436";

function unit(
  name: "waia-fhv-observer.service" | "waia-fhv-campaign.service",
  overrides: Partial<{
    embeddedRunId: string | null;
    embeddedTargetSha: string | null;
    embeddedOrganizationId: string | null;
    unitFileExists: boolean;
    workingDirectory: string;
  }> = {},
) {
  return {
    unitName: name,
    unitFileExists: overrides.unitFileExists ?? true,
    unitFilePath: `/etc/systemd/system/${name}`,
    unitFileSha256: "a".repeat(64),
    loadState: "loaded",
    unitFileState: "enabled",
    activeState: "active",
    subState: "running",
    fragmentPath: `/etc/systemd/system/${name}`,
    enabledState: "enabled",
    activeClass: "active",
    isFailed: false,
    execStart: "/usr/bin/node",
    workingDirectory: overrides.workingDirectory ?? `/opt/waia/waia-${FAILED_SHA}`,
    environmentFilePath: "/etc/waia/fhv.env",
    embeddedRunId: overrides.embeddedRunId ?? FAILED_RUN,
    embeddedTargetSha: overrides.embeddedTargetSha ?? FAILED_SHA,
    embeddedOrganizationId: overrides.embeddedOrganizationId ?? ORG,
  };
}

describe("fhv-t4 residual unit identity (DEE-436)", () => {
  it("matches coherent failed-run unit pair", () => {
    expect(
      classifyFhvT4aResidualUnitIdentity({
        units: [unit("waia-fhv-observer.service"), unit("waia-fhv-campaign.service")],
        failedRunId: FAILED_RUN,
        failedTargetSha: FAILED_SHA,
        failedOrganizationId: ORG,
      }),
    ).toBe("FHV_T4A_RESIDUAL_UNIT_IDENTITY_MATCH");
  });

  it("blocks run ID mismatch", () => {
    expect(
      classifyFhvT4aResidualUnitIdentity({
        units: [
          unit("waia-fhv-observer.service", { embeddedRunId: "other-run" }),
          unit("waia-fhv-campaign.service"),
        ],
        failedRunId: FAILED_RUN,
        failedTargetSha: FAILED_SHA,
        failedOrganizationId: ORG,
      }),
    ).toBe("FHV_T4A_RESIDUAL_UNIT_IDENTITY_RUN_ID_MISMATCH");
  });

  it("blocks target SHA mismatch", () => {
    expect(
      classifyFhvT4aResidualUnitIdentity({
        units: [
          unit("waia-fhv-observer.service", { embeddedTargetSha: "b".repeat(40) }),
          unit("waia-fhv-campaign.service"),
        ],
        failedRunId: FAILED_RUN,
        failedTargetSha: FAILED_SHA,
        failedOrganizationId: ORG,
      }),
    ).toBe("FHV_T4A_RESIDUAL_UNIT_IDENTITY_TARGET_SHA_MISMATCH");
  });

  it("blocks mixed observer/campaign identities", () => {
    expect(
      classifyFhvT4aResidualUnitIdentity({
        units: [
          unit("waia-fhv-observer.service"),
          unit("waia-fhv-campaign.service", {
            embeddedRunId: "",
            embeddedTargetSha: "",
            embeddedOrganizationId: "",
          }),
        ],
        failedRunId: FAILED_RUN,
        failedTargetSha: FAILED_SHA,
        failedOrganizationId: ORG,
      }),
    ).toBe("FHV_T4A_RESIDUAL_UNIT_IDENTITY_MIXED_PAIR");
  });

  it("detects current/new-run units when failed bindings are old", () => {
    expect(
      classifyFhvT4aResidualUnitIdentity({
        units: [
          unit("waia-fhv-observer.service", {
            embeddedRunId: "fhv-t4a-new-run",
            embeddedTargetSha: "c".repeat(40),
          }),
          unit("waia-fhv-campaign.service", {
            embeddedRunId: "fhv-t4a-new-run",
            embeddedTargetSha: "c".repeat(40),
          }),
        ],
        failedRunId: FAILED_RUN,
        failedTargetSha: FAILED_SHA,
        failedOrganizationId: ORG,
      }),
    ).toBe("FHV_T4A_RESIDUAL_UNIT_IDENTITY_CURRENT_RUN_DETECTED");
  });

  it("blocks organization mismatch", () => {
    expect(
      classifyFhvT4aResidualUnitIdentity({
        units: [
          unit("waia-fhv-observer.service", { embeddedOrganizationId: "other-org" }),
          unit("waia-fhv-campaign.service"),
        ],
        failedRunId: FAILED_RUN,
        failedTargetSha: FAILED_SHA,
        failedOrganizationId: ORG,
      }),
    ).toBe("FHV_T4A_RESIDUAL_UNIT_IDENTITY_ORG_MISMATCH");
  });

  it("computes stable before-state digest", () => {
    const evidence = {
      units: [unit("waia-fhv-observer.service"), unit("waia-fhv-campaign.service")],
    };
    expect(fhvT4aResidualRecoveryBeforeStateDigest(evidence)).toHaveLength(64);
  });
});
