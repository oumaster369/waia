import type { Metadata } from "next";
import Link from "next/link";

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

export default async function BudgetPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const query = searchParams ? await searchParams : {};
  const rawPage = Array.isArray(query.page) ? query.page[0] : query.page;
  const requestedPage = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const pageSize = 50;
  const projection = await readPublicTreasuryForView({
    transactionOffset: (requestedPage - 1) * pageSize,
    transactionLimit: pageSize,
  });
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
          transactionPagination: projection.transactionPagination,
        }
      : null;

  return (
    <PublicPageShell
      eyebrow="Public financial record"
      title="Transactions & budget"
      intro="The confirmed current-month budget and public transaction history behind Breath of WAIA. Read-only."
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
              Current month · {formatPublicMonth(new Date().toISOString().slice(0, 7))}
            </p>
            {publishedRecord.months.find(
              (month) => month.month === new Date().toISOString().slice(0, 7),
            ) ? (
              (() => {
                const current = publishedRecord.months.find(
                  (month) => month.month === new Date().toISOString().slice(0, 7),
                )!;
                const budgetMicros = current.categories.reduce(
                  (sum, row) => sum + BigInt(row.budgetMicros),
                  0n,
                );
                const spentMicros = current.categories.reduce(
                  (sum, row) => sum + BigInt(row.spentMicros),
                  0n,
                );
                return (
                  <dl className="mt-5 grid gap-5 sm:grid-cols-3">
                    <div>
                      <dt className="text-waia-fg-subtle text-xs uppercase">Budget</dt>
                      <dd className="text-waia-fg mt-1 font-mono text-2xl tabular-nums">
                        {formatPublicMoney(budgetMicros.toString(), publishedRecord.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-waia-fg-subtle text-xs uppercase">Spent</dt>
                      <dd className="text-waia-fg mt-1 font-mono text-2xl tabular-nums">
                        {formatPublicMoney(spentMicros.toString(), publishedRecord.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-waia-fg-subtle text-xs uppercase">Remaining</dt>
                      <dd className="text-waia-fg mt-1 font-mono text-2xl tabular-nums">
                        {formatPublicMoney(
                          (budgetMicros - spentMicros).toString(),
                          publishedRecord.currency,
                        )}
                      </dd>
                    </div>
                  </dl>
                );
              })()
            ) : (
              <p className="text-waia-fg-muted mt-3">Current-month budget is not published.</p>
            )}
            <p className="text-waia-fg-subtle mt-6 text-xs">
              Confirmed annual operating budget · {publishedRecord.year}:{" "}
              <span className="font-mono tabular-nums">
                {formatPublicMoney(
                  publishedRecord.annualBudgetAmountMicros,
                  publishedRecord.currency,
                )}
              </span>
            </p>
            {projection?.funds.status === "published" ? (
              <div className="border-waia-divider mt-6 grid gap-5 border-t pt-5 sm:grid-cols-2">
                <div>
                  <p className="text-waia-fg-subtle text-xs font-semibold tracking-wide uppercase">
                    WAIA operating fund
                  </p>
                  <p className="text-waia-fg mt-2 font-mono text-xl tabular-nums">
                    {formatPublicMoney(
                      projection.funds.operatingAllocationMicros,
                      projection.funds.currency,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-waia-fg-subtle text-xs font-semibold tracking-wide uppercase">
                    Development Fund
                  </p>
                  <p className="text-waia-fg mt-2 font-mono text-xl tabular-nums">
                    {formatPublicMoney(
                      projection.funds.developmentAllocationMicros,
                      projection.funds.currency,
                    )}
                  </p>
                </div>
                <p className="text-waia-fg-muted text-xs leading-relaxed sm:col-span-2">
                  The approved annual budget is protected first. Any remaining free funds are
                  accounted to development without moving custody.
                </p>
              </div>
            ) : null}
          </section>

          <section data-testid="public-budget-months" className="flex flex-col gap-7">
            <div>
              <h2 className="font-waia-serif text-waia-fg text-2xl">Monthly budget history</h2>
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
            <nav aria-label="Transaction pages" className="flex items-center justify-between gap-4">
              <p className="text-waia-fg-subtle text-xs">
                Page {requestedPage} · {publishedRecord.transactionPagination.total} public
                transactions · 50 per page
              </p>
              <div className="flex gap-4 text-sm">
                {publishedRecord.transactionPagination.hasPrevious ? (
                  <Link
                    className="underline underline-offset-4"
                    href={`/budget?page=${requestedPage - 1}`}
                  >
                    ← Previous 50
                  </Link>
                ) : null}
                {publishedRecord.transactionPagination.hasNext ? (
                  <Link
                    className="underline underline-offset-4"
                    href={`/budget?page=${requestedPage + 1}`}
                  >
                    Next 50 →
                  </Link>
                ) : null}
              </div>
            </nav>
          </section>
        </>
      )}
    </PublicPageShell>
  );
}
