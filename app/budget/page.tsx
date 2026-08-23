import type { Metadata } from "next";

import {
  PublicPageShell,
  publicPanelClass,
  publicTableClass,
  publicTableWrapClass,
} from "@/components/public/public-page-shell";
import { readPublicTreasuryForView } from "@/lib/landing/public-data";
import {
  formatPublicDateTime,
  formatPublicMoney,
  formatPublicMonth,
} from "@/lib/landing/public-format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WAIA Budget",
  description: "The published read-only financial record behind Breath of WAIA.",
};

const cellClass = "border-b border-waia-divider px-4 py-3 align-top text-waia-fg-muted";
const headClass =
  "border-b border-waia-divider bg-waia-elevated px-4 py-3 text-xs font-semibold tracking-wide text-waia-fg-subtle uppercase";

export default async function BudgetPage() {
  const projection = await readPublicTreasuryForView();
  const budget = projection?.budget;
  const publishedRecord =
    budget?.status === "published" &&
    budget.year !== null &&
    budget.currency !== null &&
    budget.annualBudgetAmountMicros !== null &&
    projection
      ? {
          year: budget.year,
          currency: budget.currency,
          annualBudgetAmountMicros: budget.annualBudgetAmountMicros,
          months: budget.months,
          transactions: projection.transactions,
        }
      : null;

  return (
    <PublicPageShell
      eyebrow="Public financial record"
      title="WAIA Budget"
      intro="Published budgets and transactions behind the current Breath of WAIA figures. This page is read-only."
    >
      {!publishedRecord ? (
        <section data-testid="public-budget-pending" className={publicPanelClass}>
          <h2 className="font-waia-serif text-waia-fg text-xl">Not yet published</h2>
          <p className="text-waia-fg-muted mt-3 max-w-2xl leading-relaxed">
            The first complete public financial record is still awaiting publication.
          </p>
        </section>
      ) : (
        <>
          <section data-testid="public-budget-summary" className={publicPanelClass}>
            <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.14em] uppercase">
              Published annual budget · {publishedRecord.year}
            </p>
            <p className="text-waia-fg mt-3 font-mono text-3xl tabular-nums sm:text-4xl">
              {formatPublicMoney(
                publishedRecord.annualBudgetAmountMicros,
                publishedRecord.currency,
              )}
            </p>
          </section>

          <section data-testid="public-budget-months" className="flex flex-col gap-7">
            <div>
              <h2 className="font-waia-serif text-waia-fg text-2xl">Budget by month</h2>
              <p className="text-waia-fg-muted mt-2 text-sm leading-relaxed">
                Category and group limits, spending, and remaining amounts from the published
                Treasury record.
              </p>
            </div>
            {publishedRecord.months.length === 0 ? (
              <p className={publicPanelClass}>No monthly budget rows have been published.</p>
            ) : (
              publishedRecord.months.map((month) => (
                <article key={month.month} className={`${publicPanelClass} flex flex-col gap-6`}>
                  <h3 className="font-waia-serif text-waia-fg text-xl">
                    {formatPublicMonth(month.month)}
                  </h3>
                  <div>
                    <h4 className="text-waia-fg mb-3 text-sm font-semibold">Groups</h4>
                    <div className={publicTableWrapClass}>
                      <table className={publicTableClass}>
                        <caption className="sr-only">Budget groups for {month.month}</caption>
                        <thead>
                          <tr>
                            <th className={headClass} scope="col">
                              Group
                            </th>
                            <th className={headClass} scope="col">
                              Budget
                            </th>
                            <th className={headClass} scope="col">
                              Spent
                            </th>
                            <th className={headClass} scope="col">
                              Remaining
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {month.groups.map((group) => (
                            <tr key={`${group.groupName}:${group.currency}`}>
                              <th className={cellClass} scope="row">
                                {group.groupName}
                              </th>
                              <td className={`${cellClass} font-mono tabular-nums`}>
                                {formatPublicMoney(group.budgetMicros, group.currency)}
                              </td>
                              <td className={`${cellClass} font-mono tabular-nums`}>
                                {formatPublicMoney(group.spentMicros, group.currency)}
                              </td>
                              <td className={`${cellClass} font-mono tabular-nums`}>
                                {formatPublicMoney(group.remainingMicros, group.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-waia-fg mb-3 text-sm font-semibold">Categories</h4>
                    <div className={publicTableWrapClass}>
                      <table className={publicTableClass}>
                        <caption className="sr-only">Budget categories for {month.month}</caption>
                        <thead>
                          <tr>
                            <th className={headClass} scope="col">
                              Category
                            </th>
                            <th className={headClass} scope="col">
                              Group
                            </th>
                            <th className={headClass} scope="col">
                              Budget
                            </th>
                            <th className={headClass} scope="col">
                              Spent
                            </th>
                            <th className={headClass} scope="col">
                              Remaining
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {month.categories.map((category) => (
                            <tr key={`${category.code}:${category.currency}`}>
                              <th className={cellClass} scope="row">
                                {category.name}
                              </th>
                              <td className={cellClass}>{category.groupName}</td>
                              <td className={`${cellClass} font-mono tabular-nums`}>
                                {formatPublicMoney(category.budgetMicros, category.currency)}
                              </td>
                              <td className={`${cellClass} font-mono tabular-nums`}>
                                {formatPublicMoney(category.spentMicros, category.currency)}
                              </td>
                              <td className={`${cellClass} font-mono tabular-nums`}>
                                {formatPublicMoney(category.remainingMicros, category.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </article>
              ))
            )}
          </section>

          <section data-testid="public-transactions" className="flex flex-col gap-5">
            <div>
              <h2 className="font-waia-serif text-waia-fg text-2xl">Transactions</h2>
              <p className="text-waia-fg-muted mt-2 text-sm leading-relaxed">
                Only transactions explicitly approved for public detail appear here.
              </p>
            </div>
            {publishedRecord.transactions.length === 0 ? (
              <p className={publicPanelClass}>No transaction details have been published.</p>
            ) : (
              <div className={publicTableWrapClass}>
                <table className={publicTableClass}>
                  <caption className="sr-only">Published WAIA transactions</caption>
                  <thead>
                    <tr>
                      <th className={headClass} scope="col">
                        Date &amp; time
                      </th>
                      <th className={headClass} scope="col">
                        Amount
                      </th>
                      <th className={headClass} scope="col">
                        Category
                      </th>
                      <th className={headClass} scope="col">
                        Project
                      </th>
                      <th className={headClass} scope="col">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {publishedRecord.transactions.map((transaction, index) => (
                      <tr key={`${transaction.occurredAt}:${transaction.amountMicros}:${index}`}>
                        <td className={cellClass}>
                          {formatPublicDateTime(transaction.occurredAt)}
                        </td>
                        <td className={`${cellClass} font-mono tabular-nums`}>
                          {formatPublicMoney(transaction.amountMicros, transaction.currency)}
                        </td>
                        <td className={cellClass}>
                          {transaction.categoryName ?? "—"}
                          {transaction.categoryGroup ? (
                            <span className="text-waia-fg-subtle mt-1 block text-xs">
                              {transaction.categoryGroup}
                            </span>
                          ) : null}
                        </td>
                        <td className={cellClass}>{transaction.projectName ?? "—"}</td>
                        <td className={cellClass}>{transaction.description ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </PublicPageShell>
  );
}
