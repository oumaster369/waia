import { afterEach, describe, expect, it } from "vitest";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { MasterKeyProvider } from "@/lib/trader/security/master-key-provider";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { collectHtxReferenceQuoteV1Postgres, createEncryptedReferenceRawStoreV1, decodeHtxReferenceJsonV1,
  decodeHtxReferenceQuoteV1 } from "@/lib/trader/mi/htx-reference-quote-collector-v1";
import { createRiskAccountProfileV1, createRiskAccountReferenceV1, exactRiskAccountNotionalV1,
  parseRiskAccountProfileV1, riskAccountDigestV1, RISK_ACCOUNT_CHANNELS_V1, RISK_REFERENCE_METHOD_V1,
  sealRiskAccountRecordV1, type RiskAccountProfileDraftV1, type RiskReferenceMemberV1 } from "@/lib/trader/risk/v2/risk-account-source-profile-v1";

const org = "00000000-0000-4000-8000-000000000135";
const source = "00000000-0000-4000-8000-000000000136";
const digest = (label: string) => riskAccountDigestV1(label);
const begin = "2026-09-27T12:00:00.000Z", end = "2026-09-27T13:00:00.000Z";
const evidence = { sourceId: source, captureReceiptDigest: digest("capture"),
  storageBindingDigest: digest("storage"), validationReceiptDigest: digest("validation"), rawBytesDigest: digest("raw") };
function draft(): RiskAccountProfileDraftV1 {
  const assets = ["BTC", "USDT"];
  return { organizationId: org, accountId: "spot-135", credentialId: org, exchangeAccountId: "135",
    accountSourceId: source, venue: "HTX", market: "SPOT", referenceCurrency: "USDT",
    instruments: [{ instrumentIdentityDigestHex: digest("BTC/USDT"), symbol: "BTC/USDT",
      baseAsset: "BTC", quoteAsset: "USDT", referenceSourceId: source }], assets,
    strategyId: "synthetic-method-proof", strategyVersion: "v1",
    sourceContract: { evidence, statementDigest: digest("contract"),
      anchorMethod: "INDEPENDENT_SOURCE_ASSERTED_DATED_ACCOUNT", validFromUtc: begin, validUntilUtc: end,
      maxSourceAgeMs: 60000, maxReportClockSkewMs: 0, coveredAssetSetDigest: riskAccountDigestV1(assets) },
    mutationBounds: assets.flatMap(asset => RISK_ACCOUNT_CHANNELS_V1.map(channel => ({ asset, channel,
      intervalStartUtc: begin, intervalEndUtc: end, maximumPositiveQuantity: "1", maximumNegativeQuantity: "1",
      contractStatementDigest: digest("contract") }))),
    reference: { qualification: { evidence, methodVersion: RISK_REFERENCE_METHOD_V1,
      statementDigest: digest("synthetic-qualification"), validFromUtc: begin, validUntilUtc: end,
      reportTimeSemantics: "HTX_RESPONSE_GENERATION_WITH_QUALIFIED_SIDE_AGE_BOUND", venueDependence: "SINGLE_VENUE_HTX" },
      windowDurationMs: 1000, slotOffsetsMs: [0, 500], slotToleranceMs: 10, maxSideAgeMs: 10, validityMs: 5000 },
    allocation: { evidence, statementDigest: digest("synthetic-allocation"), allocationId: "allocation-135",
      version: "v1", approvedNotional: "1000", allowedSymbols: ["BTC/USDT"], validFromUtc: begin, validUntilUtc: end },
    governance: { coolingOffMs: 1, reviewReason: "Explicit synthetic inputs exercise construction only" },
    work: { maxRawBytes: 4096, requestTimeoutMs: 100, maxPages: 2, maxMembers: 20,
      maxLedgerEvents: 20, retentionSeconds: 3600 } };
}
function members(profile = createRiskAccountProfileV1(draft())): RiskReferenceMemberV1[] {
  return ["10", "12"].map((ask, slot) => sealRiskAccountRecordV1({ schemaVersion: "risk-reference-member/v1" as const,
    organizationId: org, accountId: profile.accountId, profileDigest: profile.contentDigest, windowId: "window-135", slot,
    instrumentIdentityDigestHex: digest("BTC/USDT"), symbol: "BTC/USDT", baseAsset: "BTC", quoteAsset: "USDT" as const,
    sourceReportTimeUtc: new Date(Date.parse(begin) + slot * 500).toISOString(),
    availableAtUtc: new Date(Date.parse(begin) + slot * 500).toISOString(),
    ...evidence, rawMemberPath: "tick" as const, decoderVersion: "htx-merged-lossless-scale8/v1",
    normalizedInputDigest: digest(`normalized-${slot}`), gatewayReceiptDigest: digest(`gateway-${slot}`),
    observationId: digest(`observation-${slot}`), observationContentDigest: digest(`observation-content-${slot}`),
    trustAsOfReceiptId: digest(`trust-${slot}`), bid: "9", ask, last: "100" }));
}

describe("current account profile and qualified temporal reference values", () => {
  it("seals and reads the complete explicit profile without minting runtime authority", () => {
    const profile = createRiskAccountProfileV1(draft());
    expect(parseRiskAccountProfileV1(JSON.parse(JSON.stringify(profile)))).toEqual(profile);
    expect(Object.isFrozen(profile.reference.slotOffsetsMs)).toBe(true);
  });
  it("refuses a missing external mutation channel even when all observed pages were empty", () => {
    const value = draft(); value.mutationBounds.pop();
    expect(() => createRiskAccountProfileV1(value)).toThrow("MUTATION_COVERAGE");
  });
  it("refuses duplicate channel and unsupported asset coverage", () => {
    const value = draft(); value.mutationBounds.push(value.mutationBounds[0]!);
    expect(() => createRiskAccountProfileV1(value)).toThrow("MUTATION_COVERAGE");
    const other = draft(); other.assets.push("XYZ");
    expect(() => createRiskAccountProfileV1(other)).toThrow("PROFILE_ASSET_COVERAGE");
  });
  it("does not fill missing age, allocation or schedule inputs", () => {
    for (const key of ["sourceContract", "allocation", "reference"] as const) {
      const value: Record<string, unknown> = { ...draft() }; delete value[key];
      expect(() => createRiskAccountProfileV1(value as RiskAccountProfileDraftV1)).toThrow();
    }
  });
  it("rejects post-seal edits and caller content digests", () => {
    const profile = createRiskAccountProfileV1(draft());
    expect(() => parseRiskAccountProfileV1({ ...profile, accountId: "different" })).toThrow("PROFILE_SEAL");
    expect(() => sealRiskAccountRecordV1({ contentDigest: digest("injected") })).toThrow("PRESEALED_DRAFT");
  });
  it("uses actual asks and the larger middle; genuine last remains metadata", () => {
    const profile = createRiskAccountProfileV1(draft());
    const result = createRiskAccountReferenceV1({ profile, windowId: "window-135", windowStartUtc: begin,
      assembledAtUtc: "2026-09-27T12:00:01.000Z", members: members(profile) });
    expect(result.prices[0]!.price).toBe("12");
    expect(result.validUntilUtc).toBe("2026-09-27T12:00:06.000Z");
  });
  it("requires every declared slot, distinct observation identities and exact profile scope", () => {
    const profile = createRiskAccountProfileV1(draft()), rows = members(profile);
    const construct = (actual: RiskReferenceMemberV1[]) => createRiskAccountReferenceV1({ profile,
      windowId: "window-135", windowStartUtc: begin, assembledAtUtc: "2026-09-27T12:00:01.000Z", members: actual });
    expect(() => construct(rows.slice(0, 1))).toThrow("REFERENCE_WINDOW");
    const { contentDigest: _digest, ...second } = rows[1]!;
    void _digest;
    expect(() => construct([rows[0]!, sealRiskAccountRecordV1({ ...second, observationId: rows[0]!.observationId })]))
      .toThrow("REFERENCE_MEMBER_IDENTITY_OR_TIME");
    expect(() => construct([rows[0]!, sealRiskAccountRecordV1({ ...second, accountId: "other" })]))
      .toThrow("REFERENCE_MEMBER_IDENTITY_OR_TIME");
  });
  it("waits for the complete declared window and does not refresh validity by assembling old members later", () => {
    const profile = createRiskAccountProfileV1(draft());
    const construct = (assembledAtUtc: string) => createRiskAccountReferenceV1({ profile,
      windowId: "window-135", windowStartUtc: begin, assembledAtUtc, members: members(profile) });
    expect(() => construct("2026-09-27T12:00:00.999Z")).toThrow("REFERENCE_WINDOW");
    expect(construct("2026-09-27T12:00:05.999Z").validUntilUtc).toBe("2026-09-27T12:00:06.000Z");
    expect(() => construct("2026-09-27T12:00:06.000Z")).toThrow("REFERENCE_EXPIRED");
  });
  it("refuses stale or future members and nonrepresentable notional instead of rounding", () => {
    const profile = createRiskAccountProfileV1(draft()), rows = members(profile);
    const { contentDigest: _digest, ...second } = rows[1]!;
    void _digest;
    expect(() => createRiskAccountReferenceV1({ profile, windowId: "window-135", windowStartUtc: begin,
      assembledAtUtc: "2026-09-27T12:00:01.000Z", members: [rows[0]!, sealRiskAccountRecordV1({ ...second,
        sourceReportTimeUtc: "2026-09-27T12:00:00.000Z" })] })).toThrow("REFERENCE_MEMBER_IDENTITY_OR_TIME");
    expect(exactRiskAccountNotionalV1("2", "1.5")).toBe("3");
    expect(() => exactRiskAccountNotionalV1("0.00000001", "0.00000001")).toThrow("NOTIONAL_PRECISION");
  });
});

const raw = (tick: string, prefix = '"status":"ok","ch":"market.btcusdt.detail.merged","ts":1790510400000') =>
  new TextEncoder().encode(`{${prefix},"tick":${tick}}`);
describe("fixed HTX lossless reference decoder", () => {
  it("retains exact supported decimal values that binary floating point cannot distinguish", () => {
    const value = decodeHtxReferenceQuoteV1(raw('{"bid":[9007199254740993.12345678,1],"ask":[9007199254740994.12345678,1],"close":9007199254740995.12345678}'), "BTC/USDT", 4096);
    expect(value.bid).toBe("9007199254740993.12345678");
    expect(value.last).toBe("9007199254740995.12345678");
    expect(value.reportTimeSemantics).toBe("HTX_RESPONSE_GENERATION");
  });
  it.each([
    '{"bid":[1,1],"ask":[2,1]}',
    '{"bid":[1,1],"ask":[2,1],"close":0}',
    '{"bid":[3,1],"ask":[2,1],"close":2}',
    '{"bid":[1.000000001,1],"ask":[2,1],"close":2}',
    '{"bid":[1e0,1],"ask":[2,1],"close":2}',
    '{"bid":["1",1],"ask":[2,1],"close":2}',
    '{"bid":[1,1],"ask":[2,1],"close":2,"close":2}',
  ])("refuses unsupported quote bytes %s", tick => {
    expect(() => decodeHtxReferenceQuoteV1(raw(tick), "BTC/USDT", 4096)).toThrow();
  });
  it("rejects escaped duplicate keys, secret-shaped keys, malformed UTF8 and body limits", () => {
    for (const value of ['{"ts":1,"\\u0074s":2}', '{"apiKey":"not-retainable"}'])
      expect(() => decodeHtxReferenceJsonV1(new TextEncoder().encode(value), 4096)).toThrow();
    expect(() => decodeHtxReferenceJsonV1(Uint8Array.of(0xff), 4096)).toThrow("UTF8");
    expect(() => decodeHtxReferenceJsonV1(new TextEncoder().encode("{}"), 1)).toThrow("BODY_BOUND");
  });
  it("rejects wrong symbol or missing provider time without a local-now fallback", () => {
    const tick = '{"bid":[1,1],"ask":[2,1],"close":2}';
    expect(() => decodeHtxReferenceQuoteV1(raw(tick), "ETH/USDT", 4096)).toThrow("RESPONSE_IDENTITY");
    expect(() => decodeHtxReferenceQuoteV1(raw(tick, '"status":"ok","ch":"market.btcusdt.detail.merged"'),
      "BTC/USDT", 4096)).toThrow("NUMERIC_TOKEN");
  });
  it("rejects every unsupported request bound before any transport or storage call", async () => {
    let calls = 0;
    const unexpected = async (): Promise<never> => { calls += 1; throw new Error("UNEXPECTED_IO"); };
    for (const [field, ceiling] of [["maxBytes", 1048576], ["requestTimeoutMs", 120000],
      ["retentionSeconds", 315360000]] as const) {
      for (const value of [NaN, Infinity, -1, 0, 0.5, ceiling + 1]) {
        await expect(collectHtxReferenceQuoteV1Postgres({ db: {} as WaiaPostgresDb,
          context: { organizationId: org }, sourceId: source, symbol: "BTC/USDT", maxBytes: 4096,
          requestTimeoutMs: 100, retentionSeconds: 3600, [field]: value,
          signal: new AbortController().signal, fetchImpl: unexpected,
          store: { put: unexpected, read: unexpected, inspectRetained: unexpected },
        })).rejects.toThrow("REQUEST_INPUT");
      }
    }
    expect(calls).toBe(0);
  });
});

describe("synthetic private reference raw storage lifecycle", () => {
  const directories: string[] = [];
  let testMasterKey = randomBytes(32);
  let rejectDecrypt = false;
  const provider: MasterKeyProvider = {
    isProductionReady: () => false, getCurrentKeyVersion: () => "TEST_ONLY",
    async encryptDataKey(key) {
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", testMasterKey, iv);
      const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
      return { keyVersion: "TEST_ONLY",
        wrappedKey: Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString("base64") };
    },
    async decryptDataKey(wrapped) {
      if (rejectDecrypt || wrapped.keyVersion !== "TEST_ONLY")
        throw new Error("TEST_ONLY_KEY_UNAVAILABLE");
      const bytes = Buffer.from(wrapped.wrappedKey, "base64");
      if (bytes.length !== 60) throw new Error("TEST_ONLY_WRAPPED_KEY_SHAPE");
      const decipher = createDecipheriv("aes-256-gcm", testMasterKey, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(44));
      return Buffer.concat([decipher.update(bytes.subarray(12, 44)), decipher.final()]);
    },
  };
  afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
    testMasterKey.fill(0); testMasterKey = randomBytes(32); rejectDecrypt = false;
  });
  async function setup(maxStoredObjects = 8) {
    const directory = await mkdtemp(join(homedir(), ".waia-dee1135-raw-test-"));
    directories.push(directory); await chmod(directory, 0o700);
    const store = await createEncryptedReferenceRawStoreV1({ directory, masterKeyProvider: provider,
      maxStoredBytes: 1048576, maxStoredObjects });
    const command = { organizationId: org, sourceId: source,
      bytes: new TextEncoder().encode("SYNTHETIC_RAW_EVIDENCE_ONLY"), retentionSeconds: 3600,
      signal: new AbortController().signal };
    return { directory, store, command };
  }
  it("writes actual encrypted bytes, decrypts a fresh read and reconstructs the same immutable binding", async () => {
    const { directory, store, command } = await setup();
    const binding = await store.put(command);
    const retained = await readFile(join(directory, binding.objectReference.objectKey), "utf8");
    expect(retained).not.toContain("SYNTHETIC_RAW_EVIDENCE_ONLY");
    expect(Array.from(await store.read(binding, 4096))).toEqual(Array.from(command.bytes));
    expect(await store.inspectRetained(binding.objectReference.objectKey, 4096))
      .toEqual({ binding, retentionSeconds: 3600 });
    expect(await readdir(directory)).toEqual([binding.objectReference.objectKey]);
  });
  it("rejects nonfinite read bounds and authenticated envelope tampering", async () => {
    const { directory, store, command } = await setup();
    const binding = await store.put(command);
    await expect(store.read(binding, NaN)).rejects.toThrow("STORAGE_REFERENCE");
    await expect(store.read(binding, 1)).rejects.toThrow("STORAGE_READBACK");
    const path = join(directory, binding.objectReference.objectKey);
    const envelope = JSON.parse(await readFile(path, "utf8"));
    envelope.retentionSeconds += 1;
    await writeFile(path, JSON.stringify(envelope));
    await expect(store.read(binding, 4096)).rejects.toThrow();
  });
  it("rejects duplicate envelope fields and excess actual bytes", async () => {
    const { directory, store, command } = await setup();
    const binding = await store.put(command), path = join(directory, binding.objectReference.objectKey);
    const envelope = await readFile(path, "utf8");
    await writeFile(path, envelope.slice(0, -1) + ',"retentionSeconds":3600}');
    await expect(store.read(binding, 4096)).rejects.toThrow("STORAGE_ENVELOPE_ENCODING");
    await writeFile(path, Buffer.alloc(20000));
    await expect(store.read(binding, 4096)).rejects.toThrow("STORAGE_BOUND");
  });
  it("rejects incorrect decoded lengths and noncanonical padding before asking the key provider", async () => {
    const { directory, store, command } = await setup();
    const binding = await store.put(command), path = join(directory, binding.objectReference.objectKey);
    const original = JSON.parse(await readFile(path, "utf8"));
    expect(Buffer.from(original.wrapped.wrappedKey, "base64")).toHaveLength(60);
    let decryptCalls = 0;
    const reader = await createEncryptedReferenceRawStoreV1({ directory, maxStoredBytes: 1048576, maxStoredObjects: 8,
      masterKeyProvider: { ...provider, async decryptDataKey(wrapped) {
        decryptCalls += 1; return provider.decryptDataKey(wrapped);
      } } });
    const malformed = [
      { ...original, iv: Buffer.alloc(11).toString("base64") },
      { ...original, tag: Buffer.alloc(15).toString("base64") },
      { ...original, wrapped: { ...original.wrapped, wrappedKey: Buffer.alloc(59).toString("base64") } },
      { ...original, tag: Buffer.alloc(16).toString("base64").slice(0, -3) + "B==" },
    ];
    for (const envelope of malformed) {
      await writeFile(path, JSON.stringify(envelope));
      await expect(reader.read(binding, 4096)).rejects.toThrow();
    }
    expect(decryptCalls).toBe(0);
  });
  it("rejects an incompatible wrap result and zeroizes both owned and incorrectly unwrapped keys", async () => {
    const { directory, store, command } = await setup();
    const binding = await store.put(command);
    const wrongKey = Uint8Array.from({ length: 31 }, () => 1);
    const reader = await createEncryptedReferenceRawStoreV1({ directory, maxStoredBytes: 1048576, maxStoredObjects: 8,
      masterKeyProvider: { ...provider, async decryptDataKey() { return wrongKey; } } });
    await expect(reader.read(binding, 4096)).rejects.toThrow("STORAGE_UNWRAPPED_KEY");
    expect(wrongKey.every(byte => byte === 0)).toBe(true);
    let owned: Uint8Array | undefined;
    const writer = await createEncryptedReferenceRawStoreV1({ directory, maxStoredBytes: 1048576, maxStoredObjects: 8,
      masterKeyProvider: { ...provider, async encryptDataKey(key) {
        owned = key; return { keyVersion: "TEST_ONLY", wrappedKey: Buffer.alloc(59).toString("base64") };
      } } });
    await expect(writer.put(command)).rejects.toThrow();
    expect(owned?.length).toBe(32); expect(owned?.every(byte => byte === 0)).toBe(true);
    expect((await readdir(directory)).sort()).toEqual([".write-reservation", binding.objectReference.objectKey].sort());
  });
  it("refuses replacement directory identity while preserving the original retained object", async () => {
    const { directory, store, command } = await setup();
    const binding = await store.put(command), moved = directory + "-moved";
    await rename(directory, moved); directories.push(moved);
    await expect(store.read(binding, 4096)).rejects.toThrow();
    expect(await readdir(moved)).toEqual([binding.objectReference.objectKey]);
  });
  it("uses finite capacity backpressure without deleting the earlier object", async () => {
    const { directory, store, command } = await setup(1);
    const binding = await store.put(command);
    await expect(store.put(command)).rejects.toThrow("STORAGE_CAPACITY");
    expect((await readdir(directory)).sort()).toEqual([".write-reservation", binding.objectReference.objectKey].sort());
    expect(Array.from(await store.read(binding, 4096))).toEqual(Array.from(command.bytes));
  });
  it("preserves a recoverable encrypted prefix when readback fails; it never returns an accepted binding", async () => {
    const { directory, store, command } = await setup();
    rejectDecrypt = true;
    await expect(store.put(command)).rejects.toThrow("TEST_ONLY_KEY_UNAVAILABLE");
    const marker = JSON.parse(await readFile(join(directory, ".write-reservation"), "utf8"));
    expect(marker.organizationId).toBe(org); expect(marker.retentionSeconds).toBe(3600);
    rejectDecrypt = false;
    const recovered = await store.inspectRetained(marker.objectKey, 4096);
    expect(recovered.binding.rawBytesDigest).toBe(marker.rawBytesDigest);
    expect(Array.from(await store.read(recovered.binding, 4096))).toEqual(Array.from(command.bytes));
    await expect(store.put(command)).rejects.toThrow();
  });
  it("zeroizes an owned DEK when wrapping rejects and refuses an already aborted operation", async () => {
    const { directory, store, command } = await setup();
    const cancelled = new AbortController(); cancelled.abort();
    await expect(store.put({ ...command, signal: cancelled.signal })).rejects.toThrow("ABORTED");
    expect(await readdir(directory)).toEqual([]);
    let allocated: Uint8Array | undefined;
    const failed = await createEncryptedReferenceRawStoreV1({ directory, maxStoredBytes: 1048576, maxStoredObjects: 8,
      masterKeyProvider: { ...provider, async encryptDataKey(key) { allocated = key; throw new Error("WRAP_REJECTED"); } } });
    await expect(failed.put(command)).rejects.toThrow("WRAP_REJECTED");
    expect(allocated?.length).toBe(32); expect(allocated?.every(byte => byte === 0)).toBe(true);
  });
  it("refuses a late abort after wrapping settles, retaining no accepted body or binding", async () => {
    const { directory, command } = await setup();
    const cancellation = new AbortController();
    const store = await createEncryptedReferenceRawStoreV1({ directory, maxStoredBytes: 1048576, maxStoredObjects: 8,
      masterKeyProvider: { ...provider, async encryptDataKey(key) {
        const result = await provider.encryptDataKey(key); cancellation.abort(); return result;
      } } });
    await expect(store.put({ ...command, signal: cancellation.signal })).rejects.toThrow("ABORTED");
    expect(await readdir(directory)).toEqual([".write-reservation"]);
  });
  it("refuses collector completion after a committed encrypted prefix and starts no database owner", async () => {
    const { directory, store } = await setup();
    const cancellation = new AbortController();
    const body = raw('{"bid":[1,1],"ask":[2,1],"close":1.5}',
      `"status":"ok","ch":"market.btcusdt.detail.merged","ts":${Date.now()}`);
    await expect(collectHtxReferenceQuoteV1Postgres({ db: {} as WaiaPostgresDb,
      context: { organizationId: org }, sourceId: source, symbol: "BTC/USDT", maxBytes: 4096,
      requestTimeoutMs: 10000, retentionSeconds: 3600, signal: cancellation.signal,
      fetchImpl: async () => new Response(body),
      store: { ...store, async put(input) { const binding = await store.put(input); cancellation.abort(); return binding; } },
    })).rejects.toThrow("ABORTED");
    const objects = await readdir(directory);
    expect(objects).toHaveLength(1);
    const recovered = await store.inspectRetained(objects[0]!, 4096);
    expect(Array.from(await store.read(recovered.binding, 4096))).toEqual(Array.from(body));
  });
});
