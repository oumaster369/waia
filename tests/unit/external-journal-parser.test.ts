import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_JOURNAL_MAX_CHUNK_BYTES,
  createExternalJournalCursor,
  parseExternalJournalChunk,
  type TrustedExternalJournalSource,
} from "../../lib/trader/external-journal/parser";

const source: TrustedExternalJournalSource = Object.freeze({
  sourceId: "fixture-htx-account-a",
  organizationId: "org-fixture",
  accountId: "account-a",
  externalUid: "uid-fixture-a",
  market: "unknown",
});

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

function parse(
  chunk: Uint8Array,
  overrides: Partial<Parameters<typeof parseExternalJournalChunk>[0]> = {},
) {
  return parseExternalJournalChunk({
    source,
    generationId: "fixture-generation-1",
    cursor: createExternalJournalCursor(),
    chunk,
    chunkStartOffset: 0,
    ...overrides,
  });
}

describe("external HTX journal observation parser", () => {
  it("emits terminal quarantine provenance for exact malformed bytes without storing their content", () => {
    const rows = [
      bytes('{"secret":"do-not-store" bad}\r'),
      new Uint8Array([0xff]),
      bytes('{"event":"filled","accountId":"foreign"}'),
    ];
    const chunk = new Uint8Array(rows.flatMap((row) => [...row, 0x0a]));
    const result = parse(chunk);
    expect(result.quarantines.map((row) => row.code)).toEqual([
      "invalid_json",
      "invalid_utf8",
      "source_identity_mismatch",
    ]);
    let offset = 0;
    for (const [index, row] of rows.entries()) {
      expect(result.quarantines[index]).toEqual({
        code: result.quarantines[index]!.code,
        source,
        provenance: {
          normalizerVersion: "htx-journal-v1",
          sourceId: source.sourceId,
          generationId: "fixture-generation-1",
          byteOffset: offset,
          byteLength: row.length,
          rawSha256: createHash("sha256").update(row).digest("hex"),
        },
      });
      offset += row.length + 1;
    }
    expect(JSON.stringify(result.quarantines)).not.toContain("do-not-store");
    expect(result.cursor.nextOffset).toBe(chunk.length);
  });

  it("quarantines an oversized line exactly once at LF after a serialized restart", () => {
    const first = parse(bytes("123456"), { maxLineBytes: 5 });
    expect(first.quarantines).toEqual([]);
    expect(first.diagnostics[0]?.code).toBe("line_too_large");
    const continued = parse(bytes("789"), {
      cursor: JSON.parse(JSON.stringify(first.cursor)),
      chunkStartOffset: 6,
      maxLineBytes: 5,
    });
    expect(continued.quarantines).toEqual([]);
    expect(continued.cursor.pendingBytes).toEqual([]);
    const completed = parse(bytes("0\r\n{}\n"), {
      cursor: JSON.parse(JSON.stringify(continued.cursor)),
      chunkStartOffset: 9,
      maxLineBytes: 5,
    });
    expect(completed.quarantines).toHaveLength(1);
    expect(completed.quarantines[0]).toMatchObject({
      code: "line_too_large",
      provenance: { byteOffset: 0, byteLength: 11, rawSha256: null },
    });
    expect(completed.observations[0]?.provenance.byteOffset).toBe(12);
    const whole = parse(bytes("1234567890\r\n{}\n"), { maxLineBytes: 5 });
    expect(completed.quarantines).toEqual(whole.quarantines);
    expect(completed.observations).toEqual(whole.observations);
    const next = parse(new Uint8Array(), {
      cursor: completed.cursor,
      chunkStartOffset: completed.cursor.nextOffset,
      endOfSource: true,
    });
    expect(next.quarantines).toEqual([]);
  });

  it("finalizes discarded bytes at explicit EOF and leaves an open source unfinished", () => {
    const waiting = parse(bytes("123456"), { maxLineBytes: 5 });
    const stillOpen = parse(new Uint8Array(), { cursor: waiting.cursor, chunkStartOffset: 6 });
    expect(stillOpen.quarantines).toEqual([]);
    expect(stillOpen.cursor.discardUntilLf).toEqual({ lineOffset: 0, bytesSeen: 6 });
    const closed = parse(new Uint8Array(), {
      cursor: stillOpen.cursor,
      chunkStartOffset: 6,
      endOfSource: true,
    });
    expect(closed.quarantines[0]?.provenance).toMatchObject({ byteLength: 6, rawSha256: null });
    expect(closed.cursor.discardUntilLf).toBeUndefined();
    expect(closed.quarantines).toEqual(
      parse(bytes("123456"), {
        maxLineBytes: 5,
        endOfSource: true,
      }).quarantines,
    );
  });

  it("rolls back all output and the exact cursor when terminal records exceed the budget", () => {
    const pending = parse(bytes("123456"), { maxLineBytes: 5 });
    const chunk = bytes("\n{}\n");
    const rejected = parse(chunk, {
      cursor: pending.cursor,
      chunkStartOffset: 6,
      maxLineBytes: 5,
      maxEvents: 1,
    });
    expect(rejected.cursor).toBe(pending.cursor);
    expect(rejected.observations).toEqual([]);
    expect(rejected.quarantines).toEqual([]);
    expect(rejected.diagnostics.at(-1)?.code).toBe("event_limit_reached");
    const retry = parse(chunk, {
      cursor: rejected.cursor,
      chunkStartOffset: 6,
      maxLineBytes: 5,
      maxEvents: 2,
    });
    expect(retry.quarantines).toHaveLength(1);
    expect(retry.observations).toHaveLength(1);
    expect(retry.cursor.nextOffset).toBe(10);
    const entire = parse(bytes("123456\n{}\n"), { maxLineBytes: 5, maxEvents: 1 });
    expect(entire.cursor.nextOffset).toBe(0);
    expect(entire.quarantines).toEqual([]);
    expect(entire.observations).toEqual([]);
    const twoBadRows = parse(bytes("bad\nbad\n"), { maxEvents: 1 });
    expect(twoBadRows.cursor.nextOffset).toBe(0);
    expect(twoBadRows.quarantines).toEqual([]);
  });

  it("preserves the original pending cursor on a limit-shrink rejection and emits no control-fault records", () => {
    const pending = parse(bytes("123456"), { maxLineBytes: 8 });
    const refused = parse(bytes("\n{}\n"), {
      cursor: pending.cursor,
      chunkStartOffset: 6,
      maxLineBytes: 5,
      maxEvents: 1,
    });
    expect(refused.cursor).toBe(pending.cursor);
    expect(refused.quarantines).toEqual([]);
    const accepted = parse(bytes("\n{}\n"), {
      cursor: refused.cursor,
      chunkStartOffset: 6,
      maxLineBytes: 5,
      maxEvents: 2,
    });
    expect(accepted.quarantines[0]?.provenance.byteLength).toBe(6);
    for (const overrides of [
      { maxEvents: 0 },
      { chunkStartOffset: 2 },
      { source: { ...source, organizationId: "" } },
    ]) {
      const result = parse(bytes("bad\n"), overrides);
      expect(result.quarantines).toEqual([]);
      expect(result.cursor.nextOffset).toBe(0);
    }
  });

  it("keeps byte offsets and raw digest stable when a UTF-8 record is split across appends", () => {
    const line =
      '{"event":"entry_filled","symbol":"ETH-USDT","side":"long","ts":"2026-10-03T12:00:00Z"}\n';
    const encoded = bytes(line);
    const split = encoded.indexOf(0x45); // split inside the unfinished JSON object
    const first = parse(encoded.slice(0, split + 1));
    expect(first.observations).toHaveLength(0);
    expect(first.withheldTailBytes).toBe(split + 1);
    expect(first.cursor.nextOffset).toBe(split + 1);

    const second = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: first.cursor,
      chunk: encoded.slice(split + 1),
      chunkStartOffset: split + 1,
    });
    expect(second.observations).toHaveLength(1);
    expect(second.observations[0]).toMatchObject({
      kind: "entry_filled",
      source: { accountId: "account-a", market: "unknown" },
      provenance: {
        byteOffset: 0,
        byteLength: encoded.length - 1,
        generationId: "fixture-generation-1",
        rawSha256: createHash("sha256").update(encoded.slice(0, -1)).digest("hex"),
      },
      canonicalFill: false,
      authority: "external_executor_observation",
    });
    expect(second.observations[0]).not.toHaveProperty("market", "futures");
    expect(second.cursor.nextOffset).toBe(encoded.length);

    const switchedGeneration = parseExternalJournalChunk({
      source,
      generationId: "rotated-too-early",
      cursor: first.cursor,
      chunk: encoded.slice(split + 1),
      chunkStartOffset: split + 1,
    });
    expect(switchedGeneration.observations).toEqual([]);
    expect(switchedGeneration.diagnostics[0]?.code).toBe("source_identity_mismatch");
  });

  it("keeps terminal records identical across every two-chunk boundary", () => {
    const stream = new Uint8Array([
      ...bytes('{"event":"filled"}\nbad\r\n'),
      0xff,
      0x0a,
      ...bytes("x".repeat(48) + '\n{"event":"closed"}\n'),
    ]);
    const whole = parse(stream, { maxLineBytes: 32 });
    for (let split = 0; split <= stream.length; split += 1) {
      const left = parse(stream.slice(0, split), { maxLineBytes: 32 });
      const right = parse(stream.slice(split), {
        cursor: JSON.parse(JSON.stringify(left.cursor)),
        chunkStartOffset: split,
        maxLineBytes: 32,
      });
      expect([...left.observations, ...right.observations]).toEqual(whole.observations);
      expect([...left.quarantines, ...right.quarantines]).toEqual(whole.quarantines);
      expect(right.cursor).toEqual(whole.cursor);
    }
  });

  it("withholds a final partial UTF-8 code point and diagnoses invalid UTF-8 once framed", () => {
    const prefix = bytes('{"event":"filled","symbol":"ETH-');
    const utf8Tail = new Uint8Array([0xe2, 0x82]);
    const partial = new Uint8Array(prefix.length + utf8Tail.length);
    partial.set(prefix);
    partial.set(utf8Tail, prefix.length);
    const first = parse(partial);
    expect(first.withheldTailBytes).toBe(partial.length);
    expect(first.diagnostics).toEqual([]);

    const completedLine = new Uint8Array([...partial, 0xac, 0x22, 0x7d, 0x0a]);
    const second = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: first.cursor,
      chunk: completedLine.slice(partial.length),
      chunkStartOffset: partial.length,
    });
    expect(second.observations[0]?.contract).toBe("ETH-€");

    const malformed = parse(new Uint8Array([0xff, 0x0a]));
    expect(malformed.observations).toEqual([]);
    expect(malformed.diagnostics.map((item) => item.code)).toEqual(["invalid_utf8"]);
  });

  it("processes a non-LF-terminated final record only when the caller marks the source complete", () => {
    const record = bytes('{"event":"day_result","pnl_usdt":-3.5}');
    const waiting = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: createExternalJournalCursor(100),
      chunk: record,
      chunkStartOffset: 100,
    });
    expect(waiting.observations).toEqual([]);
    expect(waiting.withheldTailBytes).toBe(record.length);

    const complete = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: waiting.cursor,
      chunk: new Uint8Array(),
      chunkStartOffset: 100 + record.length,
      endOfSource: true,
    });
    expect(complete.observations[0]).toMatchObject({
      kind: "day_result",
      provenance: { byteOffset: 100, byteLength: record.length },
      externalEstimatedPnlUsdt: "-3.5",
    });
  });

  it("rejects identity contradictions and reports only bounded diagnostic metadata", () => {
    const hostile = bytes(
      '{"event":"position_closed","accountId":"other-account","market":"futures","token":"do-not-echo"}\n',
    );
    const result = parse(hostile);
    expect(result.observations).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "source_identity_mismatch", byteOffset: 0, byteLength: hostile.length - 1 },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("do-not-echo");
  });

  it("records malformed JSON without retaining or echoing the bad line", () => {
    const hostileLine = bytes('{"event":"filled","secret":"never echo" trailing}\n');
    const result = parse(hostileLine);
    expect(result.observations).toEqual([]);
    expect(result.diagnostics).toEqual([
      { code: "invalid_json", byteOffset: 0, byteLength: hostileLine.length - 1 },
    ]);
    expect(JSON.stringify(result.diagnostics)).not.toContain("never echo");
  });

  it("bounds chunks, lines and event counts without moving the cursor on rejected work", () => {
    const cursor = createExternalJournalCursor();
    const hugeChunk = parse(bytes("123456"), { cursor, maxChunkBytes: 5 });
    expect(hugeChunk.diagnostics[0]?.code).toBe("chunk_too_large");
    expect(hugeChunk.cursor).toBe(cursor);

    const unboundedOverride = parse(bytes("{}\n"), {
      cursor,
      maxChunkBytes: EXTERNAL_JOURNAL_MAX_CHUNK_BYTES + 1,
    });
    expect(unboundedOverride.diagnostics[0]?.code).toBe("invalid_parser_limits");
    expect(unboundedOverride.cursor).toBe(cursor);

    const hugeLine = parse(bytes("123456\n"), { maxLineBytes: 5 });
    expect(hugeLine.diagnostics.map((item) => item.code)).toEqual(["line_too_large"]);
    expect(hugeLine.withheldTailBytes).toBe(0);

    const twoRows = bytes('{"event":"filled"}\n{"event":"closed"}\n');
    const overLimit = parse(twoRows, { maxEvents: 1 });
    expect(overLimit.diagnostics.at(-1)?.code).toBe("event_limit_reached");
    expect(overLimit.observations).toEqual([]);
    expect(overLimit.cursor.nextOffset).toBe(0);
  });

  it("rejects duplicate keys, prototype keys and proxy objects safely", () => {
    for (const line of [
      '{"event":"filled","event":"closed"}\n',
      '{"accountId":"account-a","account\\u0049d":"other"}\n',
      '{"event":"closed","__proto__":{"event":"filled"}}\n',
    ]) {
      const result = parse(bytes(line));
      expect(result.observations).toEqual([]);
      expect(result.diagnostics[0]?.code).toBe("invalid_json");
    }

    const hostileInput = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("hostile trap");
        },
      },
    );
    expect(() => parseExternalJournalChunk(hostileInput as never)).not.toThrow();
    expect(parseExternalJournalChunk(hostileInput as never).diagnostics[0]?.code).toBe(
      "invalid_parser_input",
    );

    const hostileSource = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("hostile trap");
        },
      },
    );
    expect(
      parseExternalJournalChunk({
        source: hostileSource as TrustedExternalJournalSource,
        generationId: "fixture-generation-1",
        cursor: createExternalJournalCursor(),
        chunk: bytes("{}\n"),
        chunkStartOffset: 0,
      }).diagnostics[0]?.code,
    ).toBe("invalid_source_scope");

    const hostileCursor = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          throw new Error("hostile trap");
        },
      },
    );
    expect(
      parseExternalJournalChunk({
        source,
        generationId: "fixture-generation-1",
        cursor: hostileCursor as never,
        chunk: bytes("{}\n"),
        chunkStartOffset: 0,
      }).diagnostics[0]?.code,
    ).toBe("invalid_cursor");

    const unboundPending = Object.freeze({
      nextOffset: 1,
      pendingOffset: 0,
      pendingBytes: Object.freeze([123]),
    });
    const invalidCursorResult = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: unboundPending as never,
      chunk: bytes("}\n"),
      chunkStartOffset: 1,
    });
    expect(invalidCursorResult.diagnostics[0]?.code).toBe("invalid_cursor");
    expect(invalidCursorResult.cursor).toMatchObject({
      nextOffset: 0,
      pendingOffset: 0,
      pendingBytes: [],
    });

    expect(
      parseExternalJournalChunk({
        source,
        generationId: "fixture-generation-1",
        cursor: createExternalJournalCursor(),
        chunk: bytes('{"event":"filled"}'),
        chunkStartOffset: 0,
        endOfSource: "false" as never,
      }).diagnostics[0]?.code,
    ).toBe("invalid_parser_input");
  });

  it("discards a partial row when a valid line limit shrinks, across chunks, without parsing JSON-like suffixes", () => {
    const firstBytes = bytes(`{"event":"${"x".repeat(40)}`);
    const first = parse(firstBytes, { maxLineBytes: 64 });
    expect(first.observations).toEqual([]);
    expect(first.diagnostics).toEqual([]);
    expect(first.cursor.pendingBytes).toEqual(Array.from(firstBytes));

    const forgedJsonSuffix = bytes('{"event":"filled"}');
    const second = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: first.cursor,
      chunk: forgedJsonSuffix,
      chunkStartOffset: firstBytes.length,
      maxLineBytes: 32,
    });
    expect(second.observations).toEqual([]);
    expect(second.diagnostics[0]).toMatchObject({
      code: "line_too_large",
      byteOffset: 0,
      byteLength: firstBytes.length,
    });
    expect(second.cursor.pendingBytes).toEqual([]);
    expect(second.cursor.discardUntilLf?.bytesSeen).toBe(
      firstBytes.length + forgedJsonSuffix.length,
    );

    const delimiterAndValidEvent = bytes('\n{"event":"closed"}\n');
    const third = parseExternalJournalChunk({
      source,
      generationId: "fixture-generation-1",
      cursor: second.cursor,
      chunk: delimiterAndValidEvent,
      chunkStartOffset: firstBytes.length + forgedJsonSuffix.length,
      maxLineBytes: 32,
    });
    expect(third.observations.map((observation) => observation.kind)).toEqual(["closed"]);
    expect(third.observations[0]?.provenance.byteOffset).toBe(
      firstBytes.length + forgedJsonSuffix.length + 1,
    );
    expect(third.diagnostics).toEqual([]);
  });

  it("whitelists presentation fields and keeps source PnL explicitly estimated", () => {
    const result = parse(
      bytes(
        '{"event":"position_closed","symbol":"BTC-USDT","pnl_usdt":"-2.76","secret":"hidden","html":"<script>bad</script>"}\n',
      ),
    );
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      kind: "position_closed",
      source: { market: "unknown" },
      externalEstimatedPnlUsdt: "-2.76",
      canonicalFill: false,
    });
    expect(result.observations[0]).not.toHaveProperty("secret");
    expect(result.observations[0]).not.toHaveProperty("html");
    expect(result.observations[0]).not.toHaveProperty("realizedPnl");
  });

  it("normalizes only recognized event names and never creates an implicit futures market", () => {
    const result = parse(bytes('{"event":"some_new_event","symbol":"SOL-USDT"}\n'));
    expect(result.observations[0]).toMatchObject({
      kind: "unknown",
      source: { market: "unknown" },
    });
  });

  it("accepts the legacy type event alias only when canonical event keys are absent", () => {
    const result = parse(bytes('{"type":"entry_filled","symbol":"ETH-USDT"}\n'));
    expect(result.observations[0]).toMatchObject({
      kind: "entry_filled",
      contract: "ETH-USDT",
    });
  });

  it("keeps unknown-market instruments unconfirmed and rejects market/instrument mismatches", () => {
    const unknownMarket = parse(bytes('{"kind":"filled","coin":"ETH"}\n'));
    expect(unknownMarket.observations[0]).toMatchObject({
      kind: "filled",
      instrumentKind: "asset",
      asset: "ETH",
      source: { market: "unknown" },
      authority: "external_executor_observation",
      canonicalFill: false,
    });

    const futuresCoin = parse(bytes('{"kind":"filled","coin":"ETH"}\n'), {
      source: { ...source, market: "futures" },
    });
    expect(futuresCoin.observations).toEqual([]);
    expect(futuresCoin.diagnostics[0]?.code).toBe("conflicting_instrument_fields");

    const spotContract = parse(bytes('{"kind":"filled","contract":"ETH-USDT"}\n'), {
      source: { ...source, market: "spot" },
    });
    expect(spotContract.observations).toEqual([]);
    expect(spotContract.diagnostics[0]?.code).toBe("conflicting_instrument_fields");

    const spotSymbolAlias = parse(bytes('{"kind":"filled","symbol":"ETH-USDT"}\n'), {
      source: { ...source, market: "spot" },
    });
    expect(spotSymbolAlias.observations).toEqual([]);
    expect(spotSymbolAlias.diagnostics[0]?.code).toBe("conflicting_instrument_fields");

    const bothInstruments = parse(bytes('{"kind":"filled","contract":"ETH-USDT","coin":"ETH"}\n'));
    expect(bothInstruments.observations).toEqual([]);
    expect(bothInstruments.diagnostics[0]?.code).toBe("conflicting_instrument_fields");
  });

  it("normalizes synthetic rows using the supplied futures and spot writer keys", () => {
    const futuresSource = { ...source, market: "futures" as const };
    const futures = parse(
      bytes(
        '{"ts":"2026-10-03T12:00:00+03:00","market":"futures","kind":"entry_filled","contract":"ETH-USDT","direction":"long","avg":2670,"contracts":2}\n',
      ),
      { source: futuresSource },
    );
    expect(futures.observations[0]).toMatchObject({
      kind: "entry_filled",
      contract: "ETH-USDT",
      side: "long",
      source: { market: "futures" },
    });

    const spotSource = { ...source, market: "spot" as const };
    const spot = parse(
      bytes(
        '{"ts":"2026-10-03T12:00:00+03:00","kind":"filled","coin":"ETH","type":"market","qty":0.25,"avg_price":2500}\n' +
          '{"kind":"closed","coin":"ETH","pnl_usdt":-1.25}\n' +
          '{"kind":"entry_placed","type":"limit","coin":"BTC","qty":0.01}\n',
      ),
      { source: spotSource },
    );
    expect(spot.observations.map((observation) => observation.kind)).toEqual([
      "filled",
      "closed",
      "entry_placed",
    ]);
    expect(spot.observations.map((observation) => observation.asset)).toEqual([
      "ETH",
      "ETH",
      "BTC",
    ]);
    expect(spot.observations.every((observation) => observation.contract === undefined)).toBe(true);
    expect(spot.observations.every((observation) => observation.instrumentKind === "asset")).toBe(
      true,
    );
    expect(spot.observations.every((observation) => observation.source.market === "spot")).toBe(
      true,
    );
  });

  it("recognizes the observed futures writer kind vocabulary", () => {
    const kinds = [
      "daily_stop",
      "day_result",
      "day_start",
      "entry_cancelled",
      "entry_filled",
      "entry_placed",
      "leverage_set",
      "position_closed",
      "skipped",
    ];
    const journal = bytes(
      kinds
        .map((kind) => JSON.stringify({ kind, market: "futures", contract: "ETH-USDT" }))
        .join("\n") + "\n",
    );
    const result = parse(journal, { source: { ...source, market: "futures" } });
    expect(result.observations.map((observation) => observation.kind)).toEqual(kinds);
  });

  it("rejects contradictory event and instrument aliases", () => {
    const eventConflict = parse(
      bytes('{"kind":"entry_filled","event":"position_closed","contract":"ETH-USDT"}\n'),
      { source: { ...source, market: "futures" } },
    );
    expect(eventConflict.observations).toEqual([]);
    expect(eventConflict.diagnostics[0]?.code).toBe("conflicting_event_fields");

    const instrumentConflict = parse(
      bytes('{"kind":"entry_filled","contract":"ETH-USDT","symbol":"BTC-USDT"}\n'),
      { source: { ...source, market: "futures" } },
    );
    expect(instrumentConflict.observations).toEqual([]);
    expect(instrumentConflict.diagnostics[0]?.code).toBe("conflicting_instrument_fields");
  });

  it("preserves large numeric order identifiers and file order when event time moves backward", () => {
    const journal = bytes(
      '{"event":"filled","order_id":9007199254740993123456789,"ts":"2026-10-03T12:00:00Z"}\n' +
        '{"event":"day_result","order_id":9007199254740993123456790,"ts":"2026-10-02T12:00:00Z"}\n',
    );
    const result = parse(journal);
    expect(result.observations.map((observation) => observation.orderId)).toEqual([
      "9007199254740993123456789",
      "9007199254740993123456790",
    ]);
    expect(result.observations.map((observation) => observation.provenance.byteOffset)).toEqual([
      0,
      bytes('{"event":"filled","order_id":9007199254740993123456789,"ts":"2026-10-03T12:00:00Z"}\n')
        .length,
    ]);
    expect(result.observations.map((observation) => observation.sourceEventTime)).toEqual([
      "2026-10-03T12:00:00Z",
      "2026-10-02T12:00:00Z",
    ]);
  });
});
