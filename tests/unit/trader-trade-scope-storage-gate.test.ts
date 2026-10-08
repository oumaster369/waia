import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CredentialPayloadInvalidError } from "@/lib/trader/credentials/errors";
import { buildHtxObservationPermissionMetadata, parseHtxPermissionMetadata } from "@/lib/trader/security/htx-credential-types";
import { requireHtxStoredPermissionMetadata } from "@/lib/trader/security/htx-secure-credential-resolver";
import {
  assertTradeScopeStoredOnlyWhenLiveEnabledV1,
  permissionMetadataIncludesTradeScopeV1,
} from "@/lib/trader/credentials/trade-scope-storage-gate";

describe("trade scope storage gate", () => {
  it("treats only an explicit trade scope as trade", () => {
    expect(permissionMetadataIncludesTradeScopeV1(null)).toBe(false);
    expect(permissionMetadataIncludesTradeScopeV1({ read: true })).toBe(false);
    expect(permissionMetadataIncludesTradeScopeV1({ scopes: ["read"] })).toBe(false);
    expect(permissionMetadataIncludesTradeScopeV1({ scopes: ["read", "trade"] })).toBe(true);
  });

  it("refuses a trade scope when live is omitted or false and allows it when enabled", () => {
    const permissionMetadata = { scopes: ["trade"] };
    expect(() =>
      assertTradeScopeStoredOnlyWhenLiveEnabledV1({
        permissionMetadata,
        orgLiveEnabled: false,
      }),
    ).toThrow(CredentialPayloadInvalidError);
    expect(() =>
      assertTradeScopeStoredOnlyWhenLiveEnabledV1({
        permissionMetadata: { scopes: ["read"] },
        orgLiveEnabled: false,
      }),
    ).not.toThrow();
    expect(() =>
      assertTradeScopeStoredOnlyWhenLiveEnabledV1({
        permissionMetadata,
        orgLiveEnabled: true,
      }),
    ).not.toThrow();
  });

  it("does not hardcode an enabled live switch in the storage path", () => {
    const source = [
      "lib/trader/credentials/credential-service.ts",
      "lib/trader/credentials/connect-handler.ts",
      "lib/trader/credentials/trade-scope-storage-gate.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/orgLiveEnabled:\s*true/);
    expect(source).toContain('input.orgLiveEnabled === true');
  });

  it("stores exact observation-purpose Read+Trade without live and preserves the actual scopes", () => {
    const permissionMetadata = buildHtxObservationPermissionMetadata({
      exchangeAccountId: "10001", scopes: ["read", "trade"],
    });
    expect(permissionMetadata).toMatchObject({ version: 2, purpose: "observation", scopes: ["read", "trade"] });
    expect(parseHtxPermissionMetadata(permissionMetadata)).toEqual(permissionMetadata);
    expect(() => assertTradeScopeStoredOnlyWhenLiveEnabledV1({
      permissionMetadata, venue: "htx", exchangeAccountId: "10001", orgLiveEnabled: false,
    })).not.toThrow();
    expect(requireHtxStoredPermissionMetadata({
      permissionMetadata, venue: "htx", exchangeAccountId: "10001", purpose: "read",
    })).toEqual(permissionMetadata);
    expect(() => requireHtxStoredPermissionMetadata({
      permissionMetadata, venue: "htx", exchangeAccountId: "10001", purpose: "trade",
    })).toThrow("Observation credentials cannot authorize execution");
  });

  it.each([
    { version: 1, purpose: "observation" },
    { version: 2, purpose: "trade" },
    { version: 2, purpose: null },
    { scopes: ["read", "trade", "withdraw"] },
    { scopes: ["read", "trade", "transfer"] },
    { scopes: ["read", "read", "trade"] },
    { scopes: ["trade"] },
    { exchangeAccountId: "10002" },
    { withdrawForbidden: false },
  ])("does not accept an observation claim with invalid policy or account: %j", (change) => {
    const permissionMetadata = {
      ...buildHtxObservationPermissionMetadata({ exchangeAccountId: "10001", scopes: ["read", "trade"] }),
      ...change,
    };
    for (const orgLiveEnabled of [false, true]) {
      expect(() => assertTradeScopeStoredOnlyWhenLiveEnabledV1({
        permissionMetadata, venue: "htx", exchangeAccountId: "10001", orgLiveEnabled,
      })).toThrow(CredentialPayloadInvalidError);
    }
  });
});
