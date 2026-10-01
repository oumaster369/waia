import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CredentialPayloadInvalidError } from "@/lib/trader/credentials/errors";
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
    expect(source).toContain('liveState?.state === "ENABLED"');
  });
});
