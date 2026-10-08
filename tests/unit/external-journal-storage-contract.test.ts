import { describe, expect, it } from "vitest";
import { createExternalJournalCursor, EXTERNAL_JOURNAL_MAX_LINE_BYTES } from "../../lib/trader/external-journal/parser";
import {
  externalJournalDigest,
  isPreparedExternalJournalBatch,
  prepareExternalJournalBatch,
  snapshotExternalJournalLease,
  snapshotExternalJournalStorage,
  type ExternalJournalStorageLease,
  type ExternalJournalSourceEvidence,
} from "../../lib/trader/external-journal/storage-contract";

const now = 1700000000000;
const bytes = (text: string) => new TextEncoder().encode(text);
function lease(): ExternalJournalStorageLease {
  return snapshotExternalJournalLease({
    source: { sourceId: "10000000-0000-4000-8000-000000000001", organizationId: "20000000-0000-4000-8000-000000000001",
      credentialId: "30000000-0000-4000-8000-000000000001", accountId: "fixture-account",
      credentialRevision: "1", bindingRevision: "1", externalUid: "fixture-uid", market: "spot", apiMode: "spot",
      writerDiscriminator: "fixture-writer", sourceFingerprint: "a".repeat(64), verificationReceipt: "b".repeat(64),
      verifiedAtMs: now - 1000, verificationExpiresAtMs: now + 120000 },
    generationId: "fixture-generation", generationFingerprint: "c".repeat(64), cursorVersion: 0,
    state: "ACTIVE", cursor: createExternalJournalCursor(), token: "40000000-0000-4000-8000-000000000001",
    ownerId: "fixture-worker", claimedAtMs: now, expiresAtMs: now + 60000,
  });
}
function input(text: string, current = lease()) {
  const chunk = bytes(text);
  return { lease: current, chunk, chunkStartOffset: current.cursor.nextOffset,
    sourceEvidence: { sourceFingerprint: current.source.sourceFingerprint,
      generationFingerprint: current.generationFingerprint, sizeBefore: current.cursor.nextOffset + chunk.length,
      sizeAfter: current.cursor.nextOffset + chunk.length, observedAtMs: now + 1,
      prefixVerified: true } satisfies ExternalJournalSourceEvidence };
}
const nextLease = (previous: ReturnType<typeof prepareExternalJournalBatch>) =>
  snapshotExternalJournalLease({ ...previous.lease, cursor: previous.cursor,
    cursorVersion: previous.lease.cursorVersion + 1 });

describe("external journal durable preparation", () => {
  it("prepares one atomic cursor with accepted observations and terminal quarantines, never arbitrary source payload", () => {
    const result = prepareExternalJournalBatch(input('{"kind":"filled","coin":"BTC","password":"never-copy"}\n{"secret":"never-retain" broken}\n'));
    expect(result.records.map(r => r.recordKind)).toEqual(["observation", "quarantine"]);
    expect(result.records[0]!.payload).toMatchObject({ authority: "external_executor_observation", canonicalFill: false, asset: "BTC" });
    expect(result.records[1]).toMatchObject({ code: "invalid_json", payload: null });
    expect(JSON.stringify(result)).not.toMatch(/never-copy|never-retain|password|secret/);
    expect(result.cursor.nextOffset).toBe(result.chunkByteLength);
    expect(result.records.every(r => /^[0-9a-f]{64}$/.test(r.recordDigest))).toBe(true);
  });

  it("owns frozen source, evidence and cursor snapshots across caller mutation", () => {
    const original = input('{"kind":"filled"}\n');
    const mutable = JSON.parse(JSON.stringify(original.lease));
    const result = prepareExternalJournalBatch({ ...original, lease: mutable });
    const digest = result.digest;
    mutable.source.externalUid = "changed";
    mutable.cursor.nextOffset = 999;
    original.sourceEvidence.sizeAfter = 1;
    original.chunk.fill(0);
    expect(result.lease.source.externalUid).toBe("fixture-uid");
    expect(result.lease.cursor.nextOffset).toBe(0);
    expect(result.digest).toBe(digest);
    expect(Object.isFrozen(result.lease.source)).toBe(true);
    expect(Object.isFrozen(result.cursor.pendingBytes)).toBe(true);
    expect(Object.isFrozen(result.records[0]!.payload)).toBe(true);
  });

  it("brands only parser-prepared in-memory snapshots and refuses extra caller records", () => {
    const result = prepareExternalJournalBatch(input('{}\n'));
    expect(isPreparedExternalJournalBatch(result)).toBe(true);
    expect(isPreparedExternalJournalBatch(JSON.parse(JSON.stringify(result)))).toBe(false);
    expect(() => prepareExternalJournalBatch({ ...input('{}\n'), records: [] } as Parameters<typeof prepareExternalJournalBatch>[0]))
      .toThrow("INVALID_INPUT");
  });

  it.each(["sourceFingerprint", "generationFingerprint"] as const)("refuses changed %s without resetting a cursor", field => {
    const original = input('{}\n');
    const changed = { ...original, sourceEvidence: { ...original.sourceEvidence, [field]: "d".repeat(64) } };
    expect(() => prepareExternalJournalBatch(changed)).toThrow("SOURCE_CHANGED");
    expect(original.lease.cursor.nextOffset).toBe(0);
  });

  it("refuses shrinkage and reads beyond the observed file size", () => {
    const original = input('{}\n');
    expect(() => prepareExternalJournalBatch({ ...original,
      sourceEvidence: { ...original.sourceEvidence, sizeAfter: 2 } })).toThrow("SOURCE_TRUNCATED");
    expect(() => prepareExternalJournalBatch({ ...original,
      sourceEvidence: { ...original.sourceEvidence, sizeBefore: 2 } })).toThrow("SOURCE_TRUNCATED");
  });

  it("refuses an offset discontinuity or unqualified prefix assertion", () => {
    const original = input('{}\n');
    expect(() => prepareExternalJournalBatch({ ...original, chunkStartOffset: 1 })).toThrow("OFFSET_DISCONTINUITY");
    expect(() => prepareExternalJournalBatch({ ...original,
      sourceEvidence: { ...original.sourceEvidence, prefixVerified: false } } as unknown as Parameters<typeof prepareExternalJournalBatch>[0]))
      .toThrow("INVALID_INPUT");
  });

  it.each([now - 1, now + 60000])("refuses evidence outside its lease: %d", observedAtMs => {
    const original = input('{}\n');
    expect(() => prepareExternalJournalBatch({ ...original,
      sourceEvidence: { ...original.sourceEvidence, observedAtMs } })).toThrow("STALE_EVIDENCE");
  });

  it("refuses evidence at or after source verification expiry", () => {
    const current = lease();
    const original = input('{}\n', { ...current,
      source: { ...current.source, verificationExpiresAtMs: now + 1 } });
    expect(() => prepareExternalJournalBatch(original)).toThrow("STALE_EVIDENCE");
  });

  it("reconstructs a partial UTF-8 line after JSON hydration without losing its start", () => {
    const full = bytes('{"kind":"filled","coin":"Б"}\n');
    const split = full.indexOf(0xd0) + 1;
    const firstInput = input("");
    const first = prepareExternalJournalBatch({ ...firstInput, chunk: full.slice(0, split),
      sourceEvidence: { ...firstInput.sourceEvidence, sizeBefore: full.length, sizeAfter: full.length } });
    expect(first.records).toEqual([]);
    const hydrated = JSON.parse(JSON.stringify(nextLease(first)));
    const secondInput = input("", hydrated);
    const second = prepareExternalJournalBatch({ ...secondInput, chunk: full.slice(split),
      sourceEvidence: { ...secondInput.sourceEvidence, sizeBefore: full.length, sizeAfter: full.length } });
    expect(second.records).toHaveLength(1);
    expect(second.records[0]).toMatchObject({ byteOffset: 0, byteLength: full.length - 1, payload: { asset: "Б" } });
    expect(second.cursor.pendingBytes).toEqual([]);
  });

  it("persists bounded discard state but quarantines an oversized line only at completion", () => {
    const prefix = "x".repeat(EXTERNAL_JOURNAL_MAX_LINE_BYTES + 1);
    const first = prepareExternalJournalBatch(input(prefix));
    expect(first.records).toEqual([]);
    expect(first.cursor.pendingBytes).toEqual([]);
    expect(first.cursor.discardUntilLf).toEqual({ lineOffset: 0, bytesSeen: prefix.length });
    const second = prepareExternalJournalBatch(input("tail\n", nextLease(first)));
    expect(second.records).toHaveLength(1);
    expect(second.records[0]).toMatchObject({ byteOffset: 0, byteLength: prefix.length + 4,
      rawSha256: null, code: "line_too_large", recordKind: "quarantine", payload: null });
    expect(second.cursor.discardUntilLf).toBeUndefined();
  });

  it("commits no preparation when the shared record budget refuses the batch", () => {
    const original = input('{}\n'.repeat(501));
    expect(() => prepareExternalJournalBatch(original)).toThrow("PARSER_REFUSED");
    expect(original.lease.cursor.nextOffset).toBe(0);
    expect(original.lease.cursor.pendingBytes).toEqual([]);
  });

  it("requires observed EOF before finalizing a partial tail", () => {
    const first = prepareExternalJournalBatch(input('{"kind":"filled"}'));
    const eof = prepareExternalJournalBatch({ ...input("", nextLease(first)), endOfSource: true });
    expect(eof.records).toHaveLength(1);
    expect(eof.endOfSource).toBe(true);
    expect(eof.cursor.pendingBytes).toEqual([]);
    const original = input('{}\n');
    expect(() => prepareExternalJournalBatch({ ...original, endOfSource: true,
      sourceEvidence: { ...original.sourceEvidence, sizeAfter: original.chunk.length + 1 } })).toThrow("SOURCE_TRUNCATED");
  });

  it("refuses a no-progress batch instead of manufacturing another cursor version", () => {
    expect(() => prepareExternalJournalBatch(input(""))).toThrow("NO_PROGRESS");
  });

  it("admits an explicitly evidenced EOF-only transition for empty or already newline-terminated generations", () => {
    const empty = prepareExternalJournalBatch({ ...input(""), endOfSource: true });
    expect(empty.endOfSource).toBe(true);
    expect(empty.records).toEqual([]);
    const open = prepareExternalJournalBatch(input('{}\n'));
    const closed = prepareExternalJournalBatch({ ...input("", nextLease(open)), endOfSource: true });
    expect(closed.records).toEqual([]);
    expect(closed.cursor).toEqual(open.cursor);
    expect(closed.endOfSource).toBe(true);
  });

  it("binds the byte commitment and record kind into retry identity", () => {
    const a = prepareExternalJournalBatch(input('{"kind":"filled"}\n'));
    const b = prepareExternalJournalBatch(input('{"kind":"closed"}\n'));
    expect(a.chunkByteLength).toBe(b.chunkByteLength);
    expect(a.digest).not.toBe(b.digest);
    expect(a.records[0]!.recordDigest).not.toBe(b.records[0]!.recordDigest);
    expect(prepareExternalJournalBatch(input('{"kind":"filled"}\n')).digest).toBe(a.digest);
  });

  it("canonicalizes object order for equality with PostgreSQL JSONB", () => {
    expect(externalJournalDigest({ a: 1, b: { y: 2, x: 1 } }))
      .toBe(externalJournalDigest({ b: { x: 1, y: 2 }, a: 1 }));
  });

  it("rejects impossible or cross-source hydrated cursors before async work", () => {
    const current = lease();
    expect(() => snapshotExternalJournalStorage({ ...current,
      cursor: { ...current.cursor, nextOffset: 1 } })).toThrow("INVALID_INPUT");
    expect(() => snapshotExternalJournalStorage({ ...current,
      cursor: { ...current.cursor, generationId: "different-generation" } })).toThrow("INVALID_INPUT");
    expect(() => snapshotExternalJournalStorage({ ...current,
      cursor: { ...current.cursor, boundSource: { ...current.cursor.boundSource!, externalUid: "foreign" } } }))
      .toThrow("INVALID_INPUT");
  });

  it("rejects getters and proxies without evaluating their payloads", () => {
    let accessed = false;
    const original = input('{}\n');
    const hostile = Object.defineProperty({ ...original }, "lease", { get() { accessed = true; return original.lease; } });
    expect(() => prepareExternalJournalBatch(hostile)).toThrow("INVALID_INPUT");
    expect(() => prepareExternalJournalBatch(new Proxy(original, {}))).toThrow("INVALID_INPUT");
    expect(accessed).toBe(false);
  });

  it("copies typed bytes without invoking a caller iterator, byteLength getter or species", () => {
    let accessed = false;
    const original = input('{}\n');
    Object.defineProperty(original.chunk, "byteLength", { get() { accessed = true; return 0; } });
    Object.defineProperty(original.chunk, Symbol.iterator, { value() { accessed = true; throw new Error("hostile iterator"); } });
    Object.defineProperty(original.chunk, "constructor", { get() { accessed = true; throw new Error("hostile species"); } });
    const result = prepareExternalJournalBatch(original);
    expect(result.chunkByteLength).toBe(3);
    expect(result.records).toHaveLength(1);
    expect(accessed).toBe(false);
  });

  it("refuses shared mutable source bytes", () => {
    const original = input('{}\n');
    expect(() => prepareExternalJournalBatch({ ...original, chunk: new Uint8Array(new SharedArrayBuffer(3)) }))
      .toThrow("INVALID_INPUT");
  });
});
