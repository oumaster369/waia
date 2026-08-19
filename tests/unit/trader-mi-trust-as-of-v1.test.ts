import { describe, expect, it } from "vitest";

import { evaluatePitChronologyV1, pitChronologyV1 } from "@/lib/trader/mi/pit-chronology-v1";
import {
  isTrustAsOfReceiptV1ContentAddressed,
  resolveTrustAsOfV1,
  type TrustAsOfRevisionV1,
} from "@/lib/trader/mi/trust-as-of-v1";

const ORG = "00000000-0000-4000-8000-000000065401";
const SOURCE = "00000000-0000-4000-8000-000000065402";
const ANCHOR = new Date("2026-08-19T12:00:00.000Z");
const at = (iso: string) => new Date(iso);
const rowId = (seq: number) =>
  `00000000-0000-4000-8000-${String(654_100 + seq).padStart(12, "0")}`;

function revision(seq: number, patch: Partial<TrustAsOfRevisionV1> = {}): TrustAsOfRevisionV1 {
  return {
    id: rowId(seq), organizationId: ORG, sourceId: SOURCE,
    trustScore: seq === 1 ? "0.70000000" : "0.80000000",
    contentDigest: String(seq).repeat(64),
    revisionOf: seq === 1 ? null : rowId(seq - 1), revisionSeq: seq,
    chronology: pitChronologyV1({
      eventTime: at(`2026-08-19T0${seq}:00:00.000Z`),
      availableAt: at(`2026-08-19T0${seq}:05:00.000Z`),
      ingestTime: at(`2026-08-19T0${seq}:10:00.000Z`),
    }),
    ...patch,
  };
}

const resolve = (history: TrustAsOfRevisionV1[], anchorTime = ANCHOR) =>
  resolveTrustAsOfV1({ organizationId: ORG, sourceId: SOURCE, anchorTime, history });

describe("PitChronologyV1", () => {
  it("keeps event, availability, and ingest independent", () => {
    const result = evaluatePitChronologyV1(pitChronologyV1({
      eventTime: at("2026-08-19T11:30:00.000Z"),
      availableAt: at("2026-08-19T11:10:00.000Z"),
      ingestTime: at("2026-08-19T11:20:00.000Z"),
    }), ANCHOR);
    expect(result.status).toBe("VISIBLE");
  });

  it("rejects a mismatched chronology version", () => {
    const chronology = { ...revision(1).chronology, schemaVersion: "pit-chronology-v2" };
    expect(evaluatePitChronologyV1(chronology as never, ANCHOR)).toEqual({
      status: "UNKNOWN", reason: "INVALID_CHRONOLOGY_SCHEMA_VERSION",
    });
  });

  it.each([
    ["eventTime", null, "MISSING_EVENT_TIME"],
    ["availableAt", null, "MISSING_AVAILABLE_AT"],
    ["ingestTime", null, "MISSING_INGEST_TIME"],
    ["availableAt", new Date("invalid"), "INVALID_AVAILABLE_AT"],
    ["eventTime", at("2026-08-19T12:00:00.001Z"), "EVENT_TIME_AFTER_ANCHOR"],
    ["availableAt", at("2026-08-19T12:00:00.001Z"), "AVAILABLE_AT_AFTER_ANCHOR"],
    ["ingestTime", at("2026-08-19T12:00:00.001Z"), "INGEST_TIME_AFTER_ANCHOR"],
  ] as const)("fails closed for %s = %s", (field, value, reason) => {
    const chronology = pitChronologyV1({
      eventTime: at("2026-08-19T10:00:00.000Z"),
      availableAt: at("2026-08-19T10:01:00.000Z"),
      ingestTime: at("2026-08-19T10:02:00.000Z"),
    });
    chronology[field] = value;
    expect(evaluatePitChronologyV1(chronology, ANCHOR)).toEqual({ status: "UNKNOWN", reason });
  });
});

describe("TrustAsOfReceiptV1", () => {
  it("resolves a complete prefix deterministically across input order", () => {
    const first = resolve([revision(1), revision(2)]);
    expect(resolve([revision(2), revision(1)])).toEqual(first);
    const invalid = revision(2, { revisionSeq: Number.NaN });
    expect(resolve([invalid, revision(1)])).toEqual(resolve([revision(1), invalid]));
    const invalidDigest = revision(3, { contentDigest: "invalid" });
    expect(resolve([invalidDigest, invalid])).toEqual(resolve([invalid, invalidDigest]));
    const duplicateId = revision(2, { id: rowId(1), trustScore: "0.1" });
    expect(resolve([duplicateId, revision(1)])).toEqual(resolve([revision(1), duplicateId]));
    expect(first).toMatchObject({
      id: first.contentDigest, status: "RESOLVED", selectedRevisionSeq: 2,
      selectedTrustScore: "0.80000000",
    });
    expect(first.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(isTrustAsOfReceiptV1ContentAddressed(first)).toBe(true);
    expect(isTrustAsOfReceiptV1ContentAddressed({ ...first, selectedTrustScore: "0.1" })).toBe(false);
  });

  it("excludes future extensions from prior receipt identity", () => {
    const future = revision(3, { chronology: pitChronologyV1({
      eventTime: at("2026-08-20T01:00:00Z"), availableAt: at("2026-08-20T01:05:00Z"),
      ingestTime: at("2026-08-20T01:10:00Z"),
    }) });
    expect(resolve([future, revision(2), revision(1)])).toEqual(resolve([revision(1), revision(2)]));
  });

  it.each([
    [[revision(1, { chronology: pitChronologyV1({ eventTime: at("2026-08-20T01:00:00Z"), availableAt: at("2026-08-20T01:01:00Z"), ingestTime: at("2026-08-20T01:02:00Z") }) })], "FUTURE_ONLY"],
    [[revision(1), revision(2, { chronology: pitChronologyV1({ eventTime: at("2026-08-19T02:00:00Z"), availableAt: null, ingestTime: at("2026-08-19T02:10:00Z") }) })], "MISSING_AVAILABLE_AT"],
    [[revision(1), revision(3)], "INCOMPLETE_VISIBLE_PREFIX"],
    [[revision(1), revision(2, { id: rowId(1) })], "DUPLICATE_REVISION_ID"],
    [[revision(1), revision(2, { revisionSeq: Number.NaN })], "INVALID_REVISION_SEQUENCE"],
    [[revision(1), revision(2, { revisionOf: "00000000-0000-4000-8000-000000000000" })], "BROKEN_PREDECESSOR_LINK"],
    [[revision(1), revision(2), revision(2, { id: rowId(9) })], "DUPLICATE_REVISION_SEQUENCE"],
    [[revision(1, { organizationId: "00000000-0000-4000-8000-000000065499" })], "SCOPE_MISMATCH"],
  ] as const)("returns typed UNKNOWN for fail-closed history: %s", (history, reason) => {
    expect(resolve([...history])).toMatchObject({ status: "UNKNOWN", unknownReason: reason });
  });

  it("content-addresses invalid-anchor UNKNOWN", () => {
    const receipt = resolve([revision(1)], new Date("invalid"));
    expect(receipt).toMatchObject({ status: "UNKNOWN", unknownReason: "INVALID_ANCHOR_TIME" });
    expect(receipt.contentDigest).toMatch(/^[0-9a-f]{64}$/);
  });
});
