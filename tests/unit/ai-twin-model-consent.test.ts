import { describe, expect, it } from "vitest";

import {
  parseConsentGrantIssuanceIntent,
  parseModelConsentGrant,
  type ConsentGrantIssuanceIntent,
} from "@/lib/ai-twin/model/consent";
import { TWIN_RETENTION_POLICY } from "@/lib/ai-twin/model/lifecycle";

function intent(changes: Partial<ConsentGrantIssuanceIntent> = {}): ConsentGrantIssuanceIntent {
  return {
    requestId: "99999999-9999-4999-8999-999999999999",
    confirmed: true,
    purpose: "formation",
    sources: ["dialogue", "diary"],
    permittedUses: ["productive_private_modelling"],
    disclosureBoundary: "private_only",
    retentionPolicyId: TWIN_RETENTION_POLICY,
    temporal: changes.temporal ?? {
      mode: "EXPIRES_AT",
      expiresAt: "2027-09-14T12:00:00.000Z",
    },
    ...changes,
  };
}

describe("ConsentGrant issuance intent is explicit and grants no identity authority", () => {
  it.each([
    { mode: "UNTIL_REVOKED" as const, expiresAt: null },
    { mode: "EXPIRES_AT" as const, expiresAt: "2027-09-14T12:00:00.000Z" },
  ])("requires explicit $mode temporal choice", (temporal) => {
    const input = intent({ temporal });
    const result = parseConsentGrantIssuanceIntent(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
    expect(Object.isFrozen(result.permittedUses)).toBe(true);
    expect(Object.isFrozen(result.temporal)).toBe(true);
  });

  it("requires every purpose/source/use/disclosure/policy field explicitly", () => {
    for (const field of [
      "purpose",
      "requestId",
      "sources",
      "permittedUses",
      "disclosureBoundary",
      "retentionPolicyId",
      "temporal",
    ] as const) {
      const input = { ...intent() };
      delete input[field];
      expect(() => parseConsentGrantIssuanceIntent(input)).toThrow("INVALID_CONSENT_INTENT");
    }
  });

  it("admits only v1 dialogue/Diary productive private modelling", () => {
    for (const bad of [
      intent({ sources: [] }),
      intent({ sources: ["dialogue", "dialogue"] }),
      intent({ sources: ["imported_service" as "dialogue"] }),
      intent({ permittedUses: [] }),
      intent({ permittedUses: ["raw_only" as "productive_private_modelling"] }),
      intent({ disclosureBoundary: "public" as "private_only" }),
    ])
      expect(() => parseConsentGrantIssuanceIntent(bad)).toThrow("INVALID_CONSENT_INTENT");
  });

  it("rejects missing/default, contradictory and malformed temporal modes", () => {
    for (const temporal of [
      {},
      { mode: "UNTIL_REVOKED" },
      { mode: "UNTIL_REVOKED", expiresAt: "2027-09-14T12:00:00.000Z" },
      { mode: "EXPIRES_AT", expiresAt: null },
      { mode: "EXPIRES_AT", expiresAt: "2027-09-14" },
      { mode: "FOREVER", expiresAt: null },
    ])
      expect(() =>
        parseConsentGrantIssuanceIntent(
          intent({ temporal: temporal as ConsentGrantIssuanceIntent["temporal"] }),
        ),
      ).toThrow("INVALID_CONSENT_INTENT");
  });

  it("rejects inferred or caller-manufactured authority fields", () => {
    for (const extra of [
      { actorUserId: "11111111-1111-4111-8111-111111111111" },
      { subjectUserId: "11111111-1111-4111-8111-111111111111" },
      { organizationId: "22222222-2222-4222-8222-222222222222" },
      { role: "admin" },
      { grantId: "caller-selected" },
      { issuedAt: "2026-09-14T12:00:00.000Z" },
      { formationProgress: 100 },
      { subscription: "active" },
      { silenceMeansConsent: true },
    ])
      expect(() => parseConsentGrantIssuanceIntent({ ...intent(), ...extra })).toThrow(
        "INVALID_CONSENT_INTENT",
      );
  });

  it("rejects hostile objects and returns an input-independent value", () => {
    let read = false;
    const getter = intent();
    Object.defineProperty(getter, "purpose", {
      enumerable: true,
      get() {
        read = true;
        return "formation";
      },
    });
    expect(() => parseConsentGrantIssuanceIntent(getter)).toThrow("INVALID_CONSENT_INTENT");
    expect(read).toBe(false);

    expect(() => parseConsentGrantIssuanceIntent(new Proxy(intent(), {}))).toThrow(
      "INVALID_CONSENT_INTENT",
    );
    const cyclic = intent() as ConsentGrantIssuanceIntent & { cycle?: unknown };
    cyclic.cycle = cyclic;
    expect(() => parseConsentGrantIssuanceIntent(cyclic)).toThrow("INVALID_CONSENT_INTENT");

    const input = intent();
    const result = parseConsentGrantIssuanceIntent(input);
    input.sources[0] = "diary";
    expect(result.sources).toEqual(["dialogue", "diary"]);
  });
});

describe("persisted ConsentGrant shape", () => {
  const grant = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version: 1,
    scope: { organizationId: "org-1", subjectId: "human-1" },
    purpose: "formation",
    sources: ["dialogue"],
    mode: "private_modelling",
    permittedUses: ["productive_private_modelling"],
    disclosureBoundary: "private_only",
    issuedAt: "2026-09-14T12:00:00.000Z",
    temporalMode: "UNTIL_REVOKED",
    expiresAt: null,
    revokedAt: null,
    retentionPolicyId: TWIN_RETENTION_POLICY,
  } as const;

  it("accepts explicit append-only temporal data without making it current", () => {
    expect(parseModelConsentGrant(grant)).toEqual(grant);
  });

  it("fails closed for malformed chronology, fields and hostile storage payloads", () => {
    for (const bad of [
      { ...grant, temporalMode: "EXPIRES_AT", expiresAt: grant.issuedAt },
      { ...grant, revokedAt: "2026-09-14T11:59:59.000Z" },
      { ...grant, permittedUses: [] },
      { ...grant, role: "admin" },
      new Proxy(grant, {}),
    ])
      expect(() => parseModelConsentGrant(bad)).toThrow("INVALID_CONSENT_GRANT");
  });
});
