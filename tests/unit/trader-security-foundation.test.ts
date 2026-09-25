import { describe, expect, it } from "vitest";

import { HtxConnectorValidationError } from "@/lib/trader/connectors/htx/errors";
import {
  assertCredentialDecryptionAllowed,
  assertCredentialStorageAllowed,
} from "@/lib/trader/security/credential-storage-gate";
import {
  assertHtxPermissionMetadataSafe,
  buildHtxPermissionMetadata,
  HTX_CREDENTIAL_METADATA_VERSION,
  parseHtxPermissionMetadata,
  validateHtxConnectorCredentialInput,
} from "@/lib/trader/security/htx-credential-types";
import {
  resolveHtxSecureCredential,
  toHtxExchangeConnectorConfig,
} from "@/lib/trader/security/htx-secure-credential-resolver";
import { DevMasterKeyProvider } from "@/lib/trader/security/dev-master-key-provider";
import { MasterKeyNotReadyError } from "@/lib/trader/security/errors";
import { SecretsStoreMasterKeyProvider } from "@/lib/trader/security/secrets-store-master-key-provider";
import {
  containsSensitiveCredentialMaterial,
  redactSensitiveText,
  sanitizeClientErrorMessage,
} from "@/lib/trader/security/redaction";

const TEST_MASTER_KEY_B64 = Buffer.alloc(32, 9).toString("base64");

describe("trader security foundation (DEE-221)", () => {
  describe("redaction", () => {
    it("redacts query-string secrets and long base64 blobs", () => {
      const raw =
        "AccessKeyId=leak-key&Signature=abc123signature&apiSecret=super-secret-value " +
        "payload=YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw";
      const redacted = redactSensitiveText(raw);

      expect(redacted).not.toContain("leak-key");
      expect(redacted).not.toContain("super-secret-value");
      expect(redacted).not.toContain("abc123signature");
      expect(redacted).toContain("AccessKeyId=[REDACTED]");
      expect(redacted).toContain("Signature=[REDACTED]");
      expect(containsSensitiveCredentialMaterial(raw)).toBe(true);
      expect(containsSensitiveCredentialMaterial(redacted)).toBe(false);
    });

    it("sanitizeClientErrorMessage never returns raw credential substrings", () => {
      const message = sanitizeClientErrorMessage("apiSecret=TOP-SECRET apiKey=LEAK-123");
      expect(message).not.toContain("TOP-SECRET");
      expect(message).not.toContain("LEAK-123");
    });
  });

  describe("HTX credential types", () => {
    it("builds typed spot permission metadata with withdraw/transfer forbidden", () => {
      const metadata = buildHtxPermissionMetadata({
        exchangeAccountId: "100009",
        scopes: ["read", "trade"],
        warnings: ["probe-warning"],
        accountLabel: "primary",
      });

      expect(metadata.version).toBe(HTX_CREDENTIAL_METADATA_VERSION);
      expect(metadata.marketType).toBe("spot");
      expect(metadata.withdrawForbidden).toBe(true);
      expect(metadata.transferForbidden).toBe(true);
      expect(metadata.scopes).toEqual(["read", "trade"]);
    });

    it("rejects withdraw scope in stored permission metadata", () => {
      expect(() =>
        assertHtxPermissionMetadataSafe({
          version: HTX_CREDENTIAL_METADATA_VERSION,
          marketType: "spot",
          exchangeAccountId: "100009",
          scopes: ["read", "withdraw"],
          warnings: [],
          withdrawForbidden: true,
          transferForbidden: true,
        }),
      ).toThrow(HtxConnectorValidationError);
    });

    it("parses permission metadata from persisted JSON shape", () => {
      const parsed = parseHtxPermissionMetadata({
        version: HTX_CREDENTIAL_METADATA_VERSION,
        marketType: "spot",
        exchangeAccountId: "100009",
        scopes: ["read"],
        warnings: [],
        withdrawForbidden: true,
        transferForbidden: true,
      });

      expect(parsed?.exchangeAccountId).toBe("100009");
    });

    it.each([
      { version: 2 }, { version: undefined }, { marketType: "futures" },
      { scopes: [] }, { scopes: ["trade"] }, { scopes: ["read", "transfer"] },
      { scopes: ["read", "withdraw"] }, { scopes: ["read", "unknown"] },
      { scopes: ["read", 1] }, { scopes: "read" }, { warnings: [1] },
      { withdrawForbidden: false }, { transferForbidden: false },
      { transferForbidden: "true" }, { withdrawForbidden: undefined },
      { exchangeAccountId: " " }, { accountLabel: 1 },
    ])("refuses corrupt permission metadata %j without rewriting it", (change) => {
      const raw = { ...buildHtxPermissionMetadata({ exchangeAccountId: "100009", scopes: ["read", "trade"] }), ...change };
      expect(parseHtxPermissionMetadata(raw)).toBeNull();
      expect(() => resolveHtxSecureCredential({
        purpose: "trade", venue: "htx", exchangeAccountId: "100009",
        credentials: { apiKey: "synthetic-key", apiSecret: "synthetic-secret" }, permissionMetadata: raw,
      })).toThrow("PERMISSION_METADATA_UNVERIFIED");
    });

    it("missing metadata has no safe fallback", () => {
      expect(() => resolveHtxSecureCredential({
        purpose: "read", venue: "htx", exchangeAccountId: "100009",
        credentials: { apiKey: "synthetic-key", apiSecret: "synthetic-secret" }, permissionMetadata: null,
      })).toThrow("PERMISSION_METADATA_UNVERIFIED");
    });

    it("read purpose does not imply trade permission", () => {
      const input = { venue: "htx", exchangeAccountId: "100009",
        credentials: { apiKey: "synthetic-key", apiSecret: "synthetic-secret" },
        permissionMetadata: buildHtxPermissionMetadata({ exchangeAccountId: "100009", scopes: ["read"] }),
      };
      expect(() => resolveHtxSecureCredential({ ...input, purpose: "read" })).not.toThrow();
      expect(() => resolveHtxSecureCredential({ ...input, purpose: "trade" })).toThrow("PERMISSION_METADATA_UNVERIFIED");
    });

    it("validates connector credential input is non-empty", () => {
      expect(() => validateHtxConnectorCredentialInput({ apiKey: "  ", apiSecret: "x" })).toThrow(
        HtxConnectorValidationError,
      );
    });
  });

  describe("secure credential resolver boundary", () => {
    it("resolves HTX connector config without exposing live execution wiring", () => {
      const resolved = resolveHtxSecureCredential({
        purpose: "read",
        venue: "htx",
        exchangeAccountId: "100009",
        credentials: { apiKey: " test-key ", apiSecret: " test-secret " },
        permissionMetadata: buildHtxPermissionMetadata({
          exchangeAccountId: "100009",
          scopes: ["read"],
        }),
      });

      expect(resolved.spotAccountId).toBe("100009");
      expect(resolved.apiKey).toBe("test-key");
      expect(resolved.apiSecret).toBe("test-secret");
      expect(toHtxExchangeConnectorConfig(resolved)).toEqual({
        apiKey: "test-key",
        apiSecret: "test-secret",
        expectedSpotAccountId: "100009",
      });
    });

    it("rejects account id mismatch between row and metadata", () => {
      expect(() =>
        resolveHtxSecureCredential({
        purpose: "read",
          venue: "htx",
          exchangeAccountId: "100009",
          credentials: { apiKey: "k", apiSecret: "s" },
          permissionMetadata: buildHtxPermissionMetadata({
            exchangeAccountId: "999",
            scopes: ["read"],
          }),
        }),
      ).toThrow(HtxConnectorValidationError);
    });

    it("rejects unsupported venues", () => {
      expect(() =>
        resolveHtxSecureCredential({
        purpose: "read",
          venue: "mock",
          exchangeAccountId: "100009",
          credentials: { apiKey: "k", apiSecret: "s" },
          permissionMetadata: null,
        }),
      ).toThrow(HtxConnectorValidationError);
    });
  });

  describe("credential crypto gates", () => {
    it("blocks storage and decryption when provider is not production-ready", async () => {
      process.env.AI_TRADER_MASTER_KEY_DEV = TEST_MASTER_KEY_B64;
      const provider = await DevMasterKeyProvider.create();
      expect(() => assertCredentialStorageAllowed(provider)).toThrow(MasterKeyNotReadyError);
      expect(() => assertCredentialDecryptionAllowed(provider)).toThrow(MasterKeyNotReadyError);
    });

    it("allows storage and decryption when Secrets Store provider is production-ready", async () => {
      const provider = await SecretsStoreMasterKeyProvider.create({
        secretGetter: async () => TEST_MASTER_KEY_B64,
        productionReady: true,
      });
      expect(() => assertCredentialStorageAllowed(provider)).not.toThrow();
      expect(() => assertCredentialDecryptionAllowed(provider)).not.toThrow();
    });
  });
});
