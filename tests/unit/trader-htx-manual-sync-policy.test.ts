import { describe, expect, it } from "vitest";

import { buildHtxObservationPermissionMetadata, buildHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import { hasValidHtxManualSyncReadPolicy } from "@/lib/trader/security/htx-manual-sync-policy";

const validV1 = buildHtxPermissionMetadata({
  exchangeAccountId: "account-1",
  scopes: ["read", "trade"],
});

const validV2 = buildHtxObservationPermissionMetadata({
  exchangeAccountId: "account-1",
  scopes: ["read", "trade"],
});

describe("HTX manual sync stored read policy", () => {
  it.each([null, { scopes: ["read"] }, { ...validV1, exchangeAccountId: "account-2" },
    { ...validV1, marketType: "cross" }, { ...validV1, scopes: ["read", "withdraw"] },
    { ...validV1, withdrawForbidden: false }, { ...validV1, version: 1, purpose: "observation" },
    { ...validV2, purpose: "trade" }, { ...validV2, unexpected: true },
  ])("rejects invalid stored metadata before manual sync decrypt (%j)", (permissionMetadata) => {
    expect(hasValidHtxManualSyncReadPolicy({
      venue: "htx",
      exchangeAccountId: "account-1",
      permissionMetadata,
    })).toBe(false);
  });

  it.each([validV1, validV2])("admits a verified read policy for manual sync (%j)", (permissionMetadata) => {
    expect(hasValidHtxManualSyncReadPolicy({
      venue: "htx",
      exchangeAccountId: "account-1",
      permissionMetadata,
    })).toBe(true);
  });

  it("rejects a non-HTX venue", () => {
    expect(hasValidHtxManualSyncReadPolicy({
      venue: "other",
      exchangeAccountId: "account-1",
      permissionMetadata: validV1,
    })).toBe(false);
  });
});
