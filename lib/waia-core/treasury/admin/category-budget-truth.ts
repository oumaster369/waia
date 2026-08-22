import type {
  TreasuryCategoryBudgetHistoryRecord,
  TreasuryCategoryRecord,
} from "@/lib/waia-core/treasury/admin/ledger-catalog-types";
import { TreasuryValidationError } from "@/lib/waia-core/treasury/errors";
import type { TreasuryTransactionRecord } from "@/lib/waia-core/treasury/types";

const MONTH_RE = /^(\d{4})-(\d{2})(?:-01)?$/;

export type TreasuryCategoryBudgetRow = {
  categoryId: string;
  code: string;
  name: string;
  groupName: string;
  currency: string;
  budgetMicros: bigint;
  spentMicros: bigint;
  remainingMicros: bigint;
  isActive: boolean;
};

export type TreasuryCategoryBudgetGroupRow = {
  groupName: string;
  currency: string;
  budgetMicros: bigint;
  spentMicros: bigint;
  remainingMicros: bigint;
};

export type TreasuryCategoryBudgetMonthSummary = {
  month: string;
  categories: TreasuryCategoryBudgetRow[];
  groups: TreasuryCategoryBudgetGroupRow[];
  totals: Array<{
    currency: string;
    budgetMicros: bigint;
    spentMicros: bigint;
    remainingMicros: bigint;
  }>;
};

export type TreasuryCategoryBudgetAnnualSummary = {
  year: number;
  totals: TreasuryCategoryBudgetMonthSummary["totals"];
  months: TreasuryCategoryBudgetMonthSummary[];
};

export function normalizeBudgetMonth(value: string): string {
  const match = MONTH_RE.exec(value.trim());
  const year = match ? Number(match[1]) : NaN;
  const month = match ? Number(match[2]) : NaN;
  if (!match || !Number.isInteger(year) || year < 2000 || year > 2200 || month < 1 || month > 12) {
    throw new TreasuryValidationError("INVALID_BODY", "month must be YYYY-MM");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function currentBudgetMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function budgetMonthStart(month: string): string {
  return `${normalizeBudgetMonth(month)}-01`;
}

export function normalizeCategoryCodeBase(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleUpperCase("en-US")
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "CATEGORY";
}

function effectiveBudget(
  category: TreasuryCategoryRecord,
  month: string,
  history: readonly TreasuryCategoryBudgetHistoryRecord[],
): { amount: bigint; currency: string; groupName: string } {
  const monthStart = budgetMonthStart(month);
  let effective: TreasuryCategoryBudgetHistoryRecord | undefined;
  for (const row of history) {
    if (row.categoryId !== category.id || row.effectiveMonth > monthStart) continue;
    if (!effective || row.effectiveMonth > effective.effectiveMonth) effective = row;
  }
  return effective
    ? {
        amount: effective.monthlyBudgetMicros,
        currency: effective.currency,
        groupName: effective.groupName,
      }
    : { amount: 0n, currency: category.currency, groupName: category.groupName };
}

function transactionMonth(tx: TreasuryTransactionRecord): string {
  return tx.occurredAt.toISOString().slice(0, 7);
}

function spendByCategory(
  month: string,
  transactions: readonly TreasuryTransactionRecord[],
): Map<string, bigint> {
  const spent = new Map<string, bigint>();
  for (const tx of transactions) {
    if (
      tx.status !== "VERIFIED" ||
      tx.categoryId === null ||
      tx.duplicateOfTransactionId !== null ||
      tx.detailSupersededById !== null ||
      transactionMonth(tx) !== month
    ) {
      continue;
    }
    if (tx.cashEffectMicros === null) {
      throw new TreasuryValidationError(
        "VERIFIED_FINANCIAL_ROW_INCOMPLETE",
        "VERIFIED category transaction is missing cashEffectMicros",
      );
    }
    if (tx.cashEffectMicros >= 0n) continue;
    spent.set(tx.categoryId, (spent.get(tx.categoryId) ?? 0n) + -tx.cashEffectMicros);
  }
  return spent;
}

function aggregateRows(
  rows: readonly TreasuryCategoryBudgetRow[],
  keyOf: (row: TreasuryCategoryBudgetRow) => string,
): Map<string, { budgetMicros: bigint; spentMicros: bigint; remainingMicros: bigint }> {
  const result = new Map<
    string,
    { budgetMicros: bigint; spentMicros: bigint; remainingMicros: bigint }
  >();
  for (const row of rows) {
    const key = keyOf(row);
    const current = result.get(key) ?? {
      budgetMicros: 0n,
      spentMicros: 0n,
      remainingMicros: 0n,
    };
    current.budgetMicros += row.budgetMicros;
    current.spentMicros += row.spentMicros;
    current.remainingMicros += row.remainingMicros;
    result.set(key, current);
  }
  return result;
}

export function deriveCategoryBudgetMonth(input: {
  month: string;
  categories: readonly TreasuryCategoryRecord[];
  history: readonly TreasuryCategoryBudgetHistoryRecord[];
  transactions: readonly TreasuryTransactionRecord[];
}): TreasuryCategoryBudgetMonthSummary {
  const month = normalizeBudgetMonth(input.month);
  const spent = spendByCategory(month, input.transactions);
  const categories = input.categories
    .map((category): TreasuryCategoryBudgetRow => {
      const effective = effectiveBudget(category, month, input.history);
      const spentMicros = spent.get(category.id) ?? 0n;
      return {
        categoryId: category.id,
        code: category.code,
        name: category.name,
        groupName: effective.groupName,
        currency: effective.currency,
        budgetMicros: effective.amount,
        spentMicros,
        remainingMicros: effective.amount - spentMicros,
        isActive: category.isActive,
      };
    })
    .filter((row) => row.budgetMicros !== 0n || row.spentMicros !== 0n || row.isActive)
    .sort(
      (a, b) =>
        a.groupName.localeCompare(b.groupName) ||
        a.name.localeCompare(b.name) ||
        a.categoryId.localeCompare(b.categoryId),
    );
  const grouped = aggregateRows(categories, (row) => `${row.groupName}\u0000${row.currency}`);
  const groups = [...grouped.entries()]
    .map(([key, value]) => {
      const [groupName, currency] = key.split("\u0000");
      return { groupName, currency, ...value };
    })
    .sort((a, b) => a.groupName.localeCompare(b.groupName) || a.currency.localeCompare(b.currency));
  const byCurrency = aggregateRows(categories, (row) => row.currency);
  const totals = [...byCurrency.entries()]
    .map(([currency, value]) => ({ currency, ...value }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { month, categories, groups, totals };
}

export function deriveCategoryBudgetAnnual(input: {
  year: number;
  categories: readonly TreasuryCategoryRecord[];
  history: readonly TreasuryCategoryBudgetHistoryRecord[];
  transactions: readonly TreasuryTransactionRecord[];
}): TreasuryCategoryBudgetAnnualSummary {
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2200) {
    throw new TreasuryValidationError("INVALID_BODY", "year must be a four-digit integer");
  }
  const months = Array.from({ length: 12 }, (_, index) =>
    deriveCategoryBudgetMonth({
      month: `${input.year}-${String(index + 1).padStart(2, "0")}`,
      categories: input.categories,
      history: input.history,
      transactions: input.transactions,
    }),
  );
  const totalsByCurrency = new Map<
    string,
    { budgetMicros: bigint; spentMicros: bigint; remainingMicros: bigint }
  >();
  for (const month of months) {
    for (const total of month.totals) {
      const current = totalsByCurrency.get(total.currency) ?? {
        budgetMicros: 0n,
        spentMicros: 0n,
        remainingMicros: 0n,
      };
      current.budgetMicros += total.budgetMicros;
      current.spentMicros += total.spentMicros;
      current.remainingMicros += total.remainingMicros;
      totalsByCurrency.set(total.currency, current);
    }
  }
  return {
    year: input.year,
    totals: [...totalsByCurrency.entries()]
      .map(([currency, value]) => ({ currency, ...value }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    months,
  };
}
