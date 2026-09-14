import { describe, expect, it } from "vitest";

import type { ModelConsentGrant } from "@/lib/ai-twin/model/contracts";
import {
  admitPrivateSourceEvent,
  TWIN_SOURCE_ADMISSION_POLICY,
  type PrivateSourceAdmissionCandidate,
  type SourceAdmissionContext,
} from "@/lib/ai-twin/model/source-admission";

const scope = { organizationId: "synthetic-org", subjectId: "synthetic-human" };
const now = "2026-09-14T08:30:00.000Z";

function grant(changes: Partial<ModelConsentGrant> = {}): ModelConsentGrant {
  return {
    id: "grant-1",
    version: 2,
    scope,
    purpose: "formation",
    sources: ["dialogue", "diary"],
    mode: "private_modelling",
    issuedAt: "2026-09-01T00:00:00.000Z",
    expiresAt: "2026-10-01T00:00:00.000Z",
    revokedAt: null,
    retentionPolicyId: "human-approved-2026-09-08/v1",
    disclosureBoundary: "private_only",
    ...changes,
  };
}

function candidate(
  changes: Partial<PrivateSourceAdmissionCandidate> = {},
): PrivateSourceAdmissionCandidate {
  return {
    scope,
    sourceEventId: "source-event-1",
    createdAt: "2026-09-14T08:29:00.000Z",
    ...changes,
  };
}

function context(changes: Partial<SourceAdmissionContext> = {}): SourceAdmissionContext {
  return {
    scope,
    now,
    sourceClass: "dialogue",
    purpose: "formation",
    permittedUse: "productive_private_modelling",
    retentionPolicyId: "human-approved-2026-09-08/v1",
    resolvedGrant: { id: "grant-1", version: 2 },
    currentGrants: [grant()],
    withdrawnSourceEventIds: [],
    ...changes,
  };
}

describe("private source admission is fail-closed and grants no disclosure", () => {
  it.each(["dialogue", "diary"] as const)(
    "admits a new %s event under its exact current grant",
    (sourceClass) => {
      const result = admitPrivateSourceEvent(candidate(), context({ sourceClass }));
      expect(result).toEqual({
        policyVersion: TWIN_SOURCE_ADMISSION_POLICY,
        scope,
        sourceEventId: "source-event-1",
        sourceClass,
        createdAt: "2026-09-14T08:29:00.000Z",
        purpose: "formation",
        permittedUse: "productive_private_modelling",
        grant: { id: "grant-1", version: 2 },
        retentionPolicyId: "human-approved-2026-09-08/v1",
        disclosureBoundary: "private_only",
        productiveUseAllowed: true,
        disclosureAllowed: false,
        disclosureGrant: null,
      });
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.scope)).toBe(true);
      expect(Object.isFrozen(result.grant)).toBe(true);
    },
  );

  it("uses one current dialogue grant for separate messages without per-message re-consent", () => {
    const ctx = context();
    const first = admitPrivateSourceEvent(candidate(), ctx);
    const second = admitPrivateSourceEvent(
      candidate({
        sourceEventId: "source-event-2",
        createdAt: "2026-09-14T08:29:30.000Z",
      }),
      ctx,
    );
    expect(first.grant).toEqual(second.grant);
    expect(first.sourceEventId).not.toBe(second.sourceEventId);
    expect(first).not.toHaveProperty("perMessageConsent");
  });

  it("treats a post-withdrawal statement as a distinct new event, never a revival", () => {
    const ctx = context({ withdrawnSourceEventIds: ["source-event-1"] });
    expect(() => admitPrivateSourceEvent(candidate(), ctx)).toThrow("SOURCE_WITHDRAWN");
    const admitted = admitPrivateSourceEvent(
      candidate({
        sourceEventId: "source-event-new",
        createdAt: "2026-09-14T08:29:30.000Z",
      }),
      ctx,
    );
    expect(admitted.sourceEventId).toBe("source-event-new");
    expect(admitted).not.toHaveProperty("revives");
    expect(admitted).not.toHaveProperty("predecessor");
  });

  it("rejects unknown source classes before any productive use", () => {
    expect(() =>
      admitPrivateSourceEvent(candidate(), {
        ...context(),
        sourceClass: "imported_service",
      } as unknown as SourceAdmissionContext),
    ).toThrow("SOURCE_CLASS_NOT_ADMITTED");
  });

  it("requires the exact unique latest grant version", () => {
    expect(() => admitPrivateSourceEvent(candidate(), context({ currentGrants: [] }))).toThrow(
      "CONSENT_UNAVAILABLE",
    );
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({
          resolvedGrant: { id: "grant-1", version: 1 },
          currentGrants: [grant({ version: 1 }), grant()],
        }),
      ),
    ).toThrow("CONSENT_UNAVAILABLE");
    expect(() =>
      admitPrivateSourceEvent(candidate(), context({ currentGrants: [grant(), grant()] })),
    ).toThrow("CONSENT_UNAVAILABLE");
  });

  it("binds purpose and grant selection only from trusted adapter context", () => {
    const archiveGrant = grant({
      id: "grant-archive",
      purpose: "archive",
      retentionPolicyId: "archive-policy",
    });
    const result = admitPrivateSourceEvent(
      candidate(),
      context({ currentGrants: [grant(), archiveGrant] }),
    );
    expect(result.purpose).toBe("formation");
    expect(result.grant).toEqual({ id: "grant-1", version: 2 });
    expect(result.retentionPolicyId).toBe("human-approved-2026-09-08/v1");
  });

  it.each([
    ["raw-only use", { mode: "raw_only" }],
    ["expired authority", { expiresAt: now }],
    ["revoked authority", { revokedAt: "2026-09-14T08:00:00.000Z" }],
    ["another purpose", { purpose: "archive" }],
    ["another policy", { retentionPolicyId: "other-policy" }],
    ["non-private boundary", { disclosureBoundary: "public" }],
    ["wrong source", { sources: ["diary"] }],
  ])("rejects %s", (_label, changes) => {
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({ currentGrants: [grant(changes as Partial<ModelConsentGrant>)] }),
      ),
    ).toThrow();
  });

  it.each(["organizationId", "subjectId"] as const)(
    "isolates %s across candidate, context and grant",
    (field) => {
      const foreign = { ...scope, [field]: "foreign" };
      expect(() => admitPrivateSourceEvent(candidate({ scope: foreign }), context())).toThrow(
        "SCOPE_MISMATCH",
      );
      expect(() => admitPrivateSourceEvent(candidate(), context({ scope: foreign }))).toThrow(
        "SCOPE_MISMATCH",
      );
      expect(() =>
        admitPrivateSourceEvent(
          candidate(),
          context({ currentGrants: [grant({ scope: foreign })] }),
        ),
      ).toThrow("SCOPE_MISMATCH");
    },
  );

  it("rejects invalid source and grant chronology", () => {
    expect(() =>
      admitPrivateSourceEvent(candidate({ createdAt: "2026-09-14T08:31:00.000Z" }), context()),
    ).toThrow("INVALID_INPUT");
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({
          currentGrants: [grant({ issuedAt: "2026-09-14T08:29:30.000Z" })],
        }),
      ),
    ).toThrow("CONSENT_UNAVAILABLE");
  });

  it("rejects malformed source sets and withdrawn-event sets", () => {
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({ currentGrants: [grant({ sources: ["dialogue", "dialogue"] })] }),
      ),
    ).toThrow("INVALID_INPUT");
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({
          currentGrants: [
            grant({
              sources: ["dialogue", "imported_service"] as ModelConsentGrant["sources"],
            }),
          ],
        }),
      ),
    ).toThrow("SOURCE_CLASS_NOT_ADMITTED");
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({ withdrawnSourceEventIds: ["withdrawn", "withdrawn"] }),
      ),
    ).toThrow("INVALID_INPUT");
    expect(() =>
      admitPrivateSourceEvent(
        candidate(),
        context({ withdrawnSourceEventIds: new Array<string>(1) }),
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("rejects body authority, getters, hidden fields, cycles and custom prototypes", () => {
    for (const extra of [
      { sourceClass: "diary" },
      { purpose: "archive" },
      { grant: { id: "grant-archive", version: 1 } },
      { retentionPolicyId: "archive-policy" },
      { disclosureAllowed: true },
      { formationCredit: 1 },
      { archiveAuthority: true },
      { actionAuthority: "execute" },
      { truth: "verified" },
    ])
      expect(() => admitPrivateSourceEvent({ ...candidate(), ...extra }, context())).toThrow(
        "INVALID_INPUT",
      );

    let read = false;
    const getter = candidate();
    Object.defineProperty(getter, "purpose", {
      enumerable: true,
      get() {
        read = true;
        return "forged";
      },
    });
    expect(() => admitPrivateSourceEvent(getter, context())).toThrow("INVALID_INPUT");
    expect(read).toBe(false);

    const hidden = candidate();
    Object.defineProperty(hidden, "hiddenAuthority", { enumerable: false, value: true });
    expect(() => admitPrivateSourceEvent(hidden, context())).toThrow("INVALID_INPUT");

    const cyclic = candidate() as PrivateSourceAdmissionCandidate & { cycle?: unknown };
    cyclic.cycle = cyclic;
    expect(() => admitPrivateSourceEvent(cyclic, context())).toThrow("INVALID_INPUT");
    expect(() =>
      admitPrivateSourceEvent(
        Object.assign(Object.create({ inherited: true }), candidate()),
        context(),
      ),
    ).toThrow("INVALID_INPUT");
  });

  it("returns no content, disclosure, truth, archive, collection or action authority", () => {
    const result = admitPrivateSourceEvent(candidate(), context());
    expect(result.disclosureAllowed).toBe(false);
    expect(result.disclosureGrant).toBeNull();
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("truth");
    expect(result).not.toHaveProperty("archiveAuthority");
    expect(result).not.toHaveProperty("collectionAuthority");
    expect(result).not.toHaveProperty("actionAuthority");
    expect(result).not.toHaveProperty("formationCredit");
  });
});
