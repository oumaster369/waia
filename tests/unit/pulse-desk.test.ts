import { describe, expect, it } from "vitest";

import { cockpitStreamIsStale, parseCockpitSnapshot } from "@/lib/trader/admin/cockpit-client";
import {
  campaignRunIdForCockpit,
  derivePulseLedState,
  nextTapeWindow,
  pulseAccountObservationHref,
  pulseHaltHref,
  pulseScopedHref,
  pulseTapeFromSnapshot,
  PULSE_TAPE_WINDOW,
  readRuntimeAuthorityStrip,
} from "@/lib/trader/admin/pulse-desk";

const ORG = "11111111-1111-4111-8111-111111111111";

function snapshot(reasonCodes: readonly unknown[]) {
  return {
    organizationId: ORG,
    releaseIdentity: {
      state: "unavailable",
      source: "missing:admin-release-identity-read-model",
      asOf: { state: "unknown" },
    },
    runtimeAuthority: {
      state: "value",
      source: "runtime-authority-read-model-v2",
      asOf: { state: "known", at: "2026-09-23T10:00:00.000Z" },
      value: { availability: "READ", posture: "HALT", reasonCodes },
    },
    observationFreshness: {
      state: "unavailable",
      source: "account-observation.readLatest",
      asOf: { state: "unknown" },
    },
    c3: {
      state: "unavailable",
      source: "missing:operator-selected-campaign-run-id",
      asOf: { state: "unknown" },
    },
  };
}

describe("pulse desk derivation", () => {
  it("marks a silent live transport stale at the cockpit threshold", () => {
    expect(cockpitStreamIsStale(1_000, 20_999)).toBe(false);
    expect(cockpitStreamIsStale(1_000, 21_000)).toBe(true);
    expect(cockpitStreamIsStale(null, 21_000)).toBe(false);
    expect(derivePulseLedState("live", false)).toBe("live");
    expect(derivePulseLedState("live", true)).toBe("stale");
    expect(derivePulseLedState("poll", true)).toBe("stale");
    expect(derivePulseLedState("reconnecting", false)).toBe("reconnecting");
  });

  it("keeps reason codes that arrive inside an unchanged cockpit snapshot", () => {
    const parsed = parseCockpitSnapshot(
      JSON.stringify(snapshot(["RUNTIME_CONTROL_LEASE_INVALID", "", 1, "A_REASON"])),
      ORG,
    );
    expect(parsed).not.toBeNull();
    expect(readRuntimeAuthorityStrip(parsed?.runtimeAuthority).reasonCodes).toEqual([
      "RUNTIME_CONTROL_LEASE_INVALID",
      "A_REASON",
    ]);
    expect(readRuntimeAuthorityStrip(parsed?.runtimeAuthority)).toMatchObject({
      availability: "READ",
      posture: "HALT",
    });
    const tape = pulseTapeFromSnapshot(parsed, Date.parse("2026-09-23T10:00:05.000Z"));
    expect(tape[0]).toMatchObject({
      id: "reason:RUNTIME_CONTROL_LEASE_INVALID",
      kind: "reason",
      label: "RUNTIME_CONTROL_LEASE_INVALID",
    });
    expect(tape.some((entry) => entry.id === "fact:runtimeAuthority")).toBe(true);
  });

  it("drops an invalid campaign id and keeps HALT as a kill-switch deep link", () => {
    expect(campaignRunIdForCockpit(" run-1 ")).toBe("run-1");
    expect(campaignRunIdForCockpit("bad id")).toBe("");
    expect(pulseScopedHref("/admin/audit", ORG, "run-1")).toBe(
      `/admin/audit?organization_id=${ORG}&campaign_run_id=run-1`,
    );
    expect(pulseScopedHref("/admin/audit", ORG, "bad id")).toBe(
      `/admin/audit?organization_id=${ORG}`,
    );
    expect(pulseHaltHref(ORG)).toBe(
      `/admin/kill-switches?organization_id=${ORG}&switch_type=EMERGENCY_STOP`,
    );
    expect(pulseHaltHref("  ")).toBe("/admin/kill-switches?switch_type=EMERGENCY_STOP");
    expect(pulseHaltHref(ORG)).not.toContain("/commands");
    expect(
      pulseAccountObservationHref({
        organizationId: ORG,
        credentialId: "33333333-3333-4333-8333-333333333333",
        exchangeAccountId: "account-a",
      }),
    ).toBe(
      `/admin/account-observation?organization_id=${ORG}&credential_id=33333333-3333-4333-8333-333333333333&exchange_account_id=account-a`,
    );
  });

  it("grows the reason tape window without rendering the whole history at once", () => {
    expect(nextTapeWindow(PULSE_TAPE_WINDOW, 200)).toBe(PULSE_TAPE_WINDOW * 2);
    expect(nextTapeWindow(200, 200)).toBe(200);
  });
});
