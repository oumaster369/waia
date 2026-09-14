import { describe, expect, it } from "vitest";

import {
  TWIN_PERSONAL_MODEL_ACCESS_POLICY,
  evaluatePersonalTwinModelAccess,
  type ResolvedTwinCoreAccessContext,
} from "@/lib/ai-twin/model/core-access";

const actorUserId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";

function context(
  changes: Partial<ResolvedTwinCoreAccessContext> = {},
): ResolvedTwinCoreAccessContext {
  return {
    policyVersion: TWIN_PERSONAL_MODEL_ACCESS_POLICY,
    target: { organizationId, subjectUserId: actorUserId },
    actor: {
      authentication: "authenticated",
      actorClass: "human",
      actorUserId,
    },
    organization: { organizationId, status: "current" },
    membership: {
      organizationId,
      actorUserId,
      status: "current",
    },
    subjectBinding: {
      organizationId,
      subjectUserId: actorUserId,
      status: "current",
    },
    ...changes,
  };
}

describe("AI-TWIN personal-model Core access is identity/tenancy only", () => {
  it("allows only an authenticated Human bound to their own current organization scope", () => {
    const result = evaluatePersonalTwinModelAccess(context());
    expect(result).toEqual({
      allowed: true,
      reason: "ALLOWED",
      policyVersion: TWIN_PERSONAL_MODEL_ACCESS_POLICY,
      scope: { organizationId, subjectId: actorUserId },
      actor: { kind: "human", subjectId: actorUserId },
    });
    if (!result.allowed) throw new Error("expected admitted personal-model access");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.scope)).toBe(true);
    expect(Object.isFrozen(result.actor)).toBe(true);
  });

  it("requires no entitlement, payment, subscription or Formation state", () => {
    const result = evaluatePersonalTwinModelAccess(context());
    expect(result.allowed).toBe(true);
    expect(result).not.toHaveProperty("entitlement");
    expect(result).not.toHaveProperty("payment");
    expect(result).not.toHaveProperty("subscription");
    expect(result).not.toHaveProperty("formation");
  });

  it("fails closed for missing or unauthenticated Core context", () => {
    expect(evaluatePersonalTwinModelAccess(null)).toEqual({
      allowed: false,
      reason: "TWIN_CORE_CONTEXT_REQUIRED",
    });
    expect(evaluatePersonalTwinModelAccess(context({ actor: null }))).toEqual({
      allowed: false,
      reason: "TWIN_AUTHENTICATION_REQUIRED",
    });
    expect(
      evaluatePersonalTwinModelAccess(
        context({
          actor: {
            authentication: "unauthenticated",
            actorClass: "human",
            actorUserId: null,
          },
        }),
      ),
    ).toEqual({ allowed: false, reason: "TWIN_AUTHENTICATION_REQUIRED" });
    for (const missing of [
      { organization: null },
      { membership: null },
      { subjectBinding: null },
    ] as const)
      expect(evaluatePersonalTwinModelAccess(context(missing))).toEqual({
        allowed: false,
        reason: "TWIN_CORE_CONTEXT_REQUIRED",
      });
  });

  it.each([
    [
      "organization",
      { organization: { organizationId, status: "stale" } },
      "TWIN_ORGANIZATION_NOT_CURRENT",
    ],
    [
      "membership",
      { membership: { organizationId, actorUserId, status: "revoked" } },
      "TWIN_MEMBERSHIP_NOT_CURRENT",
    ],
    [
      "subject binding",
      { subjectBinding: { organizationId, subjectUserId: actorUserId, status: "stale" } },
      "TWIN_SUBJECT_BINDING_NOT_CURRENT",
    ],
  ] as const)("rejects non-current %s", (_label, changes, reason) => {
    expect(
      evaluatePersonalTwinModelAccess(context(changes as Partial<ResolvedTwinCoreAccessContext>)),
    ).toEqual({ allowed: false, reason });
  });

  it.each([
    [
      "resolved organization",
      {
        organization: { organizationId: "33333333-3333-4333-8333-333333333333", status: "current" },
      },
      "TWIN_ORGANIZATION_MISMATCH",
    ],
    [
      "membership organization",
      {
        membership: {
          organizationId: "33333333-3333-4333-8333-333333333333",
          actorUserId,
          status: "current",
        },
      },
      "TWIN_MEMBERSHIP_MISMATCH",
    ],
    [
      "membership actor",
      {
        membership: {
          organizationId,
          actorUserId: "33333333-3333-4333-8333-333333333333",
          status: "current",
        },
      },
      "TWIN_MEMBERSHIP_MISMATCH",
    ],
    [
      "subject organization",
      {
        subjectBinding: {
          organizationId: "33333333-3333-4333-8333-333333333333",
          subjectUserId: actorUserId,
          status: "current",
        },
      },
      "TWIN_SUBJECT_BINDING_MISMATCH",
    ],
    [
      "subject identity",
      {
        subjectBinding: {
          organizationId,
          subjectUserId: "33333333-3333-4333-8333-333333333333",
          status: "current",
        },
      },
      "TWIN_SUBJECT_BINDING_MISMATCH",
    ],
  ] as const)("rejects foreign %s", (_label, changes, reason) => {
    expect(
      evaluatePersonalTwinModelAccess(context(changes as Partial<ResolvedTwinCoreAccessContext>)),
    ).toEqual({ allowed: false, reason });
  });

  it("never lets organization membership grant another Human's private model", () => {
    const subjectUserId = "33333333-3333-4333-8333-333333333333";
    const result = evaluatePersonalTwinModelAccess(
      context({
        target: { organizationId, subjectUserId },
        subjectBinding: { organizationId, subjectUserId, status: "current" },
      }),
    );
    expect(result).toEqual({ allowed: false, reason: "TWIN_PERSONAL_SUBJECT_MISMATCH" });
  });

  it.each(["service", "agent"] as const)(
    "does not admit a matching %s actor as a privileged bypass",
    (actorClass) => {
      expect(
        evaluatePersonalTwinModelAccess(
          context({
            actor: { authentication: "authenticated", actorClass, actorUserId },
          }),
        ),
      ).toEqual({ allowed: false, reason: "TWIN_ACTOR_CLASS_NOT_ADMITTED" });
    },
  );

  it("rejects role, caller-ID and product-state fields that try to manufacture authority", () => {
    for (const extra of [
      { role: "admin" },
      { organizationOwner: true },
      { callerActorUserId: actorUserId },
      { entitlement: "twin" },
      { subscription: "active" },
      { formationProgress: 100 },
      { disclosureAuthority: true },
      { societyAuthority: true },
      { actionAuthority: true },
      { billingAuthority: true },
    ])
      expect(evaluatePersonalTwinModelAccess({ ...context(), ...extra })).toEqual({
        allowed: false,
        reason: "TWIN_CORE_CONTEXT_MALFORMED",
      });
  });

  it("rejects malformed, ambiguous and unknown trusted-context values", () => {
    const malformed = [
      context({ policyVersion: "unknown" as typeof TWIN_PERSONAL_MODEL_ACCESS_POLICY }),
      context({ target: { organizationId: "not-a-uuid", subjectUserId: actorUserId } }),
      context({
        membership: { organizationId, actorUserId, status: "unknown" as "current" },
      }),
      {
        ...context(),
        actor: { ...context().actor, role: "admin" },
      },
      [],
    ];
    for (const value of malformed)
      expect(evaluatePersonalTwinModelAccess(value)).toEqual({
        allowed: false,
        reason: "TWIN_CORE_CONTEXT_MALFORMED",
      });
  });

  it("rejects getters, hidden fields, cycles and proxies before they can become authority", () => {
    let read = false;
    const getter = context();
    Object.defineProperty(getter, "actor", {
      enumerable: true,
      get() {
        read = true;
        return context().actor;
      },
    });
    expect(evaluatePersonalTwinModelAccess(getter)).toEqual({
      allowed: false,
      reason: "TWIN_CORE_CONTEXT_MALFORMED",
    });
    expect(read).toBe(false);

    const hidden = context();
    Object.defineProperty(hidden, "role", { enumerable: false, value: "admin" });
    expect(evaluatePersonalTwinModelAccess(hidden)).toEqual({
      allowed: false,
      reason: "TWIN_CORE_CONTEXT_MALFORMED",
    });

    const cyclic = context() as ResolvedTwinCoreAccessContext & { cycle?: unknown };
    cyclic.cycle = cyclic;
    expect(evaluatePersonalTwinModelAccess(cyclic)).toEqual({
      allowed: false,
      reason: "TWIN_CORE_CONTEXT_MALFORMED",
    });

    const proxy = new Proxy(context(), {});
    expect(evaluatePersonalTwinModelAccess(proxy)).toEqual({
      allowed: false,
      reason: "TWIN_CORE_CONTEXT_MALFORMED",
    });
    const nestedProxy = context({
      target: new Proxy(context().target, {}),
    });
    expect(evaluatePersonalTwinModelAccess(nestedProxy)).toEqual({
      allowed: false,
      reason: "TWIN_CORE_CONTEXT_MALFORMED",
    });
  });

  it("returns an independent minimal decision with no adjacent authority", () => {
    const input = context();
    const result = evaluatePersonalTwinModelAccess(input);
    input.target.subjectUserId = "33333333-3333-4333-8333-333333333333";
    expect(result.allowed).toBe(true);
    expect(result).not.toHaveProperty("consent");
    expect(result).not.toHaveProperty("disclosure");
    expect(result).not.toHaveProperty("society");
    expect(result).not.toHaveProperty("action");
    expect(result).not.toHaveProperty("billing");
    expect(result).not.toHaveProperty("epistemicPersistence");
  });
});
