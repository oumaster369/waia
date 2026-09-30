import { asc, eq } from "drizzle-orm";

import * as pgSchema from "@/db/schema.postgres";
import type { WaiaPostgresDb } from "@/db/waia-postgres-transaction";
import { isPostgresUniqueViolation } from "@/lib/trader/research/postgres-unique-violation";
import {
  AppendOnlyStrategyAdmissionJournal,
  StrategyAdmissionError,
  type StrategyAdmissionJournalRow,
} from "@/lib/trader/research/strategy-admission-v1";

type JournalDb = Pick<WaiaPostgresDb, "insert" | "select">;

export type AdmissionJournalBaseline = {
  rowCount: number;
  families: ReadonlyMap<string, number>;
};

export function admissionJournalBaseline(
  journal: AppendOnlyStrategyAdmissionJournal,
): AdmissionJournalBaseline {
  return {
    rowCount: journal.list().length,
    families: new Map(
      journal.registeredFamilies().map((family) => [family.specSha256, family.familySize]),
    ),
  };
}

function rowFromPayload(value: unknown): StrategyAdmissionJournalRow {
  if (!value || typeof value !== "object") {
    throw new StrategyAdmissionError(
      "admission_journal_unavailable",
      "journal payload is not an object",
    );
  }
  const row = value as StrategyAdmissionJournalRow;
  if (
    typeof row.hypothesisId !== "string" ||
    typeof row.specSha256 !== "string" ||
    typeof row.split !== "string" ||
    !Number.isInteger(row.rowIndex)
  ) {
    throw new StrategyAdmissionError(
      "admission_journal_unavailable",
      "journal payload is incomplete",
    );
  }
  return {
    ...row,
    flags: Object.freeze([...(row.flags ?? [])]),
  };
}

export async function loadStrategyAdmissionJournal(ex: Pick<WaiaPostgresDb, "select">): Promise<{
  journal: AppendOnlyStrategyAdmissionJournal;
  baseline: AdmissionJournalBaseline;
}> {
  try {
    const families = await ex
      .select({
        specSha256: pgSchema.traderStrategyAdmissionFamily.specSha256,
        familySize: pgSchema.traderStrategyAdmissionFamily.familySize,
      })
      .from(pgSchema.traderStrategyAdmissionFamily);
    const stored = await ex
      .select({ payload: pgSchema.traderStrategyAdmissionJournal.payloadJson })
      .from(pgSchema.traderStrategyAdmissionJournal)
      .orderBy(asc(pgSchema.traderStrategyAdmissionJournal.createdAt));
    const journal = AppendOnlyStrategyAdmissionJournal.fromSnapshot({
      families,
      rows: stored.map((row) => rowFromPayload(row.payload)),
    });
    return { journal, baseline: admissionJournalBaseline(journal) };
  } catch (error) {
    if (error instanceof StrategyAdmissionError) throw error;
    throw new StrategyAdmissionError(
      "admission_journal_unavailable",
      error instanceof Error ? error.message : "journal unavailable",
    );
  }
}

/**
 * Appends new family registrations, journal rows, and one-shot split consumes.
 * The split primary key is the concurrency gate. A conflict rolls back with the caller transaction.
 */
export async function commitStrategyAdmissionJournal(
  ex: JournalDb,
  journal: AppendOnlyStrategyAdmissionJournal,
  baseline: AdmissionJournalBaseline,
): Promise<void> {
  const families = journal
    .registeredFamilies()
    .filter((family) => !baseline.families.has(family.specSha256));
  const rows = journal.list().slice(baseline.rowCount);
  for (const family of families) {
    await ex
      .insert(pgSchema.traderStrategyAdmissionFamily)
      .values({ specSha256: family.specSha256, familySize: family.familySize })
      .onConflictDoNothing();
    const existing = await ex
      .select({ familySize: pgSchema.traderStrategyAdmissionFamily.familySize })
      .from(pgSchema.traderStrategyAdmissionFamily)
      .where(eq(pgSchema.traderStrategyAdmissionFamily.specSha256, family.specSha256))
      .limit(1);
    const stored = existing[0]?.familySize;
    if (stored !== family.familySize) {
      throw new StrategyAdmissionError(
        "family_size_mismatch",
        `registered family is ${stored ?? "missing"}, caller declared ${family.familySize}`,
      );
    }
  }
  for (const row of rows) {
    if (row.countsAsSplitUse && (row.split === "validation" || row.split === "holdout")) {
      try {
        await ex.insert(pgSchema.traderStrategyAdmissionSplitConsume).values({
          specSha256: row.specSha256,
          hypothesisId: row.hypothesisId,
          split: row.split,
        });
      } catch (error) {
        if (isPostgresUniqueViolation(error)) {
          throw new StrategyAdmissionError(
            "split_already_used",
            `${row.split} already used for ${row.hypothesisId}`,
          );
        }
        throw error;
      }
    }
    await ex.insert(pgSchema.traderStrategyAdmissionJournal).values({
      specSha256: row.specSha256,
      hypothesisId: row.hypothesisId,
      split: row.split,
      countsAsSplitUse: row.countsAsSplitUse,
      payloadJson: { ...row, flags: [...row.flags] },
    });
  }
}
