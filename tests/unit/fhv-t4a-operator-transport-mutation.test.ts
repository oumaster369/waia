import { describe, expect, it } from "vitest";

import type { FhvT4aGovernedRemoteMutation } from "@/lib/trader/observability/fhv-t4a-operator-transport";

function shouldCountRemoteMutation(input: {
  remoteCommand: string;
  preauthPhase?: boolean;
  governedRemoteMutation?: FhvT4aGovernedRemoteMutation;
}): boolean {
  if (input.preauthPhase) {
    return false;
  }
  if (input.governedRemoteMutation === "residual-recovery-confirm") {
    return true;
  }
  return /(>>|>\s|tee |mkdir |touch |rm |mv |cp )/.test(input.remoteCommand);
}

describe("fhv-t4a operator transport remote mutation accounting (DEE-436)", () => {
  it("counts governed residual-recovery confirm without file-write regex", () => {
    expect(
      shouldCountRemoteMutation({
        remoteCommand:
          "FHV_T4A_RESIDUAL_RECOVERY_AUTHORIZATION='AUTHORIZE-FHV-T4A-RESIDUAL-UNIT-RECOVERY' bash -s -- --confirm --systemctl-bin /usr/bin/systemctl",
        governedRemoteMutation: "residual-recovery-confirm",
      }),
    ).toBe(true);
  });

  it("keeps PRE_AUTH phase at zero mutations", () => {
    expect(
      shouldCountRemoteMutation({
        remoteCommand: "bash -s -- --preview",
        preauthPhase: true,
        governedRemoteMutation: "residual-recovery-confirm",
      }),
    ).toBe(false);
  });

  it("does not classify read-only PRE_AUTH-style commands as mutations", () => {
    expect(
      shouldCountRemoteMutation({
        remoteCommand:
          "bash -s -- --systemctl-bin /usr/bin/systemctl --python-bin /usr/bin/python3",
        preauthPhase: true,
      }),
    ).toBe(false);
    expect(
      shouldCountRemoteMutation({
        remoteCommand: "systemctl show waia-fhv-campaign.service -p ActiveState --value",
      }),
    ).toBe(false);
  });

  it("still counts generic file-write remote commands", () => {
    expect(
      shouldCountRemoteMutation({
        remoteCommand: "mkdir -p /tmp/example && touch /tmp/example/file",
      }),
    ).toBe(true);
  });

  it("keeps recovery preview at zero mutations", () => {
    expect(
      shouldCountRemoteMutation({
        remoteCommand: "bash -s -- --preview --systemctl-bin /usr/bin/systemctl",
      }),
    ).toBe(false);
  });
});
