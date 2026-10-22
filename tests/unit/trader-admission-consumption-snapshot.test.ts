import { describe, expect, it } from "vitest";
import * as schema from "@/db/schema.postgres";
import { AppendOnlyStrategyAdmissionJournal, type StrategyAdmissionJournalRow } from "@/lib/trader/research/strategy-admission-v1";
import { loadStrategyAdmissionJournal } from "@/lib/trader/research/strategy-admission-journal-postgres";

const SPEC = "a".repeat(64);
const use = { specSha256: SPEC, hypothesisId: "chosen-candidate", split: "validation" as const };
const scored: StrategyAdmissionJournalRow = {
  rowIndex: 0, correctsRowIndex: null, ...use, familySize: 1, configParamsJson: "{}",
  nEvents: 20, nDates: 20, netMeanDate: "0.01", seMethod: "newey_west", nwLag: 1,
  t: "2", pRaw: "0.02", pHolm: "0.02", verdict: "passed_validation", verdictReason: "passed",
  flags: [], countsAsSplitUse: true, direction: "strategy", directionTrialOrdinal: 1,
};
const snapshot = (splitUses = [use], rows: StrategyAdmissionJournalRow[] = []) =>
  AppendOnlyStrategyAdmissionJournal.fromSnapshot({ families: [{ specSha256: SPEC, familySize: 1 }], rows, splitUses });

function dbStub(failConsume = false, splitUses: unknown[] = [use]) {
  const selected: unknown[] = [];
  return { selected, db: { select() { return { from(table: unknown) {
    selected.push(table);
    if (table === schema.traderStrategyAdmissionFamily) return Promise.resolve([{ specSha256: SPEC, familySize: 1 }]);
    if (table === schema.traderStrategyAdmissionJournal) return { orderBy: () => Promise.resolve([]) };
    if (table === schema.traderStrategyAdmissionSplitConsume) {
      return failConsume ? Promise.reject(new Error("store unavailable")) : Promise.resolve(splitUses);
    }
    throw new Error("unexpected table");
  } }; } } };
}

describe("committed admission consumption snapshots", () => {
  it("refuses a spent validation split without inventing any scored metric or verdict", () => {
    const journal = snapshot();
    expect(journal.list()).toEqual([]);
    expect(journal.registeredFamilySize(SPEC)).toBe(1);
    expect(journal.splitUseCount(use)).toBe(1);
    expect(() => journal.assertSplitAvailable(use)).toThrow(/split_already_used/);
  });

  it("deduplicates a consume already represented by a scored row without rewriting metrics", () => {
    const journal = snapshot([use, { ...use }], [scored]);
    expect(journal.splitUseCount(use)).toBe(1);
    expect(journal.list()).toEqual([scored]);
    expect(journal.list()[0]!.netMeanDate).toBe("0.01");
  });

  it("keeps all three exact key dimensions and also protects consumed holdout", () => {
    const journal = AppendOnlyStrategyAdmissionJournal.fromSnapshot({ families: [], rows: [],
      splitUses: [use, { ...use, hypothesisId: "blind-candidate", split: "holdout" }] });
    for (const other of [{ ...use, specSha256: "b".repeat(64) },
      { ...use, hypothesisId: "other-candidate" }, { ...use, split: "holdout" as const }]) {
      expect(journal.splitUseCount(other)).toBe(0);
      expect(() => journal.assertSplitAvailable(other)).not.toThrow();
    }
    expect(() => journal.assertSplitAvailable({ ...use, hypothesisId: "blind-candidate", split: "holdout" }))
      .toThrow(/split_already_used/);
  });

  it("captures consumed keys so mutating input cannot release a spent split", () => {
    const mutable = { ...use };
    const journal = snapshot([mutable]);
    mutable.hypothesisId = "changed";
    expect(journal.splitUseCount(use)).toBe(1);
    expect(journal.splitUseCount(mutable)).toBe(0);
  });

  it("preserves historical scored snapshots without the optional consumption input", () => {
    const journal = AppendOnlyStrategyAdmissionJournal.fromSnapshot({ families: [], rows: [scored] });
    expect(journal.splitUseCount(use)).toBe(1);
    expect(journal.list()).toEqual([scored]);
  });

  it.each([
    { ...use, specSha256: `${SPEC}\n` }, { ...use, specSha256: "invalid" },
    { ...use, hypothesisId: "" }, { ...use, hypothesisId: "a".repeat(129) },
    { ...use, split: "is" }, { ...use, split: "validation\n" }, null,
  ])("fails closed for malformed persisted consumption %#", invalid => {
    expect(() => AppendOnlyStrategyAdmissionJournal.fromSnapshot({ families: [], rows: [], splitUses: [invalid] as never }))
      .toThrow(/admission_journal_unavailable/);
  });

  it("loads the authoritative consume table without adding result rows to the commit baseline", async () => {
    const { db, selected } = dbStub();
    const { journal, baseline } = await loadStrategyAdmissionJournal(db as never);
    expect(selected).toContain(schema.traderStrategyAdmissionSplitConsume);
    expect(journal.list()).toEqual([]);
    expect(baseline.rowCount).toBe(0);
    expect(() => journal.assertSplitAvailable(use)).toThrow(/split_already_used/);
  });

  it("refuses when the consume store cannot be read instead of returning an available split", async () => {
    const { db } = dbStub(true);
    await expect(loadStrategyAdmissionJournal(db as never)).rejects.toMatchObject({ code: "admission_journal_unavailable" });
  });

  it("refuses corrupted consume records returned by the database boundary", async () => {
    const { db } = dbStub(false, [{ ...use, split: "wrong" }]);
    await expect(loadStrategyAdmissionJournal(db as never)).rejects.toMatchObject({ code: "admission_journal_unavailable" });
  });
});
