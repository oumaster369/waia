import { ContributionIntentForm } from "@/components/public/contribution-intent-form";
import {
  formatPublicDateTime,
  formatPublicMoney,
  formatPublicShare,
} from "@/lib/landing/public-format";
import type { PublishedSupportAddress } from "@/lib/landing/support-address";
import type { SelfContributionRecord } from "@/lib/waia-core/treasury/share/types";

type DashboardBreathWorkspaceProps = {
  displayName: string;
  support: PublishedSupportAddress | null;
  record: SelfContributionRecord | null;
  accountingCurrency: string;
};

const darkPanel =
  "rounded-2xl border border-[rgba(201,169,110,0.28)] bg-[#030813] p-6 text-[rgba(236,232,224,0.96)] shadow-[0_24px_70px_rgba(3,8,19,0.24)] sm:p-8";

export function DashboardBreathWorkspace({
  displayName,
  support,
  record,
  accountingCurrency,
}: DashboardBreathWorkspaceProps) {
  return (
    <main
      data-testid="dashboard-breath-workspace"
      className="bg-background flex min-w-0 flex-1 flex-col gap-6 overflow-y-auto p-5 sm:p-8 lg:p-10"
    >
      <header className="max-w-3xl">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
          Your private WAIA workspace
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Breath of WAIA</h1>
        <p className="text-muted-foreground mt-3 leading-relaxed">
          Support WAIA anonymously or prepare an exact named payment. Only confirmed contributions
          affect the Patrons record and your current share.
        </p>
      </header>

      <section className={darkPanel} data-testid="dashboard-breath-anonymous">
        <p className="text-xs font-semibold tracking-[0.14em] text-[#c9a96e] uppercase">
          Anonymous support
        </p>
        {support ? (
          <div className="mt-4 space-y-4">
            <p className="max-w-3xl text-sm leading-relaxed text-[rgba(210,205,195,0.88)]">
              Send any amount of USDT on the TRON (TRC-20) network directly to the official address.
              After Human verification it is included under “Anonymous Patrons”; no wallet identity
              is published.
            </p>
            <p className="font-mono text-sm break-all text-[#f0e4ce]">{support.address}</p>
            <a
              href={support.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-sm text-[#d4b87a] underline underline-offset-4"
            >
              Verify the official address in TronScan →
            </a>
          </div>
        ) : (
          <p className="mt-4 text-sm text-[rgba(210,205,195,0.78)]">
            The governed support address is not available. Do not send funds to an address from
            another source.
          </p>
        )}
      </section>

      <section className={darkPanel} data-testid="dashboard-breath-named">
        <p className="text-xs font-semibold tracking-[0.14em] text-[#c9a96e] uppercase">
          Named contribution
        </p>
        <h2 className="font-waia-serif mt-2 text-2xl text-[#f0e4ce]">Prepare an exact payment</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[rgba(210,205,195,0.88)]">
          Enter the amount and optional public link. WAIA adds a tiny identifying suffix. Send the
          generated amount exactly; TronGrid can then match it to your account for Human review.
        </p>
        <div className="mt-6 border-t border-[rgba(201,169,110,0.2)] pt-6">
          {support ? (
            <ContributionIntentForm displayName={displayName} />
          ) : (
            <p className="text-sm text-[rgba(210,205,195,0.78)]">
              Named payment instructions are unavailable until the official address is restored.
            </p>
          )}
        </div>
      </section>

      <section
        className="border-border bg-card rounded-2xl border p-6 sm:p-8"
        data-testid="dashboard-breath-history"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.14em] uppercase">
              Confirmed contribution history
            </p>
            <h2 className="mt-2 text-2xl font-semibold">Your participation</h2>
          </div>
          {record ? (
            <dl className="grid grid-cols-2 gap-5 text-right">
              <div>
                <dt className="text-muted-foreground text-xs uppercase">Confirmed</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">
                  {formatPublicMoney(record.numeratorMicros, accountingCurrency)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs uppercase">Current share</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums">
                  {formatPublicShare(record.partsPerMillion)}
                </dd>
              </div>
            </dl>
          ) : null}
        </div>

        {!record ? (
          <p className="text-muted-foreground mt-6 text-sm">
            Contribution history is temporarily unavailable. No financial data is guessed.
          </p>
        ) : record.contributions.length === 0 ? (
          <p className="text-muted-foreground mt-6 text-sm">
            No verified contribution has been attributed to your account yet.
          </p>
        ) : (
          <div className="border-border mt-6 overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
              <caption className="sr-only">Your confirmed WAIA contributions</caption>
              <thead className="bg-muted/60 text-muted-foreground text-xs tracking-wide uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Date &amp; time
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Amount
                  </th>
                  <th className="px-4 py-3 font-semibold" scope="col">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {record.contributions.map((row) => (
                  <tr key={row.transactionId} className="border-border border-t">
                    <td className="text-muted-foreground px-4 py-3">
                      {formatPublicDateTime(row.occurredAt)}
                    </td>
                    <td className="px-4 py-3 font-mono tabular-nums">
                      {formatPublicMoney(row.contributedAmountMicros, accountingCurrency)}
                    </td>
                    <td className="px-4 py-3">Verified</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground mt-5 text-xs leading-relaxed">
          Share is a transparent contribution ratio only. It is not ownership, profit share,
          governance power or a promise of future securities.
        </p>
      </section>
    </main>
  );
}
