import type { Metadata } from "next";

import { PublicPageShell, publicPanelClass } from "@/components/public/public-page-shell";
import { readPublicTreasuryForView } from "@/lib/landing/public-data";
import { formatPublicDateTime, formatPublicMoney } from "@/lib/landing/public-format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WAIA Foundation",
  description: "How WAIA accounts for its Operating and Development Funds.",
};

export default async function FoundationPage() {
  const projection = await readPublicTreasuryForView();
  const funds = projection?.funds.status === "published" ? projection.funds : null;

  return (
    <PublicPageShell
      eyebrow="Open accounting logic"
      title="Foundation"
      intro="How confirmed Treasury resources are protected for WAIA’s work and accounted for beyond it."
    >
      <section className={`${publicPanelClass} space-y-5`} data-testid="public-foundation-policy">
        <h2 className="font-waia-serif text-waia-fg text-2xl">One clear order</h2>
        <ol className="text-waia-fg-muted list-decimal space-y-3 pl-5 leading-relaxed">
          <li>Only verified Treasury funds enter the calculation.</li>
          <li>Active commitments are removed from free funds.</li>
          <li>The current confirmed annual operating budget is protected first.</li>
          <li>Verified free funds above that amount are accounted to the Development Fund.</li>
        </ol>
        <p className="border-waia-divider text-waia-fg-muted border-t pt-5 text-sm leading-relaxed">
          This is an accounting allocation, not a physical transfer. Money remains in the same WAIA
          accounts and wallets until an authorized expense is actually paid. The allocation does not
          grant ownership, governance power or a claim on WAIA.
        </p>
      </section>

      {funds ? (
        <section className={publicPanelClass} data-testid="public-foundation-current">
          <h2 className="font-waia-serif text-waia-fg text-2xl">Current confirmed allocation</h2>
          <dl className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <dt className="text-waia-fg-subtle text-xs tracking-wide uppercase">
                Operating Fund
              </dt>
              <dd className="text-waia-fg mt-2 font-mono text-2xl tabular-nums">
                {formatPublicMoney(funds.operatingAllocationMicros, funds.currency)}
              </dd>
            </div>
            <div>
              <dt className="text-waia-fg-subtle text-xs tracking-wide uppercase">
                Development Fund
              </dt>
              <dd className="text-waia-fg mt-2 font-mono text-2xl tabular-nums">
                {formatPublicMoney(funds.developmentAllocationMicros, funds.currency)}
              </dd>
            </div>
          </dl>
          <p className="text-waia-fg-subtle mt-5 text-xs">
            Confirmed {formatPublicDateTime(funds.allocationAsOf)} · policy {funds.policyCode} v
            {funds.policyVersion}
          </p>
        </section>
      ) : (
        <section className={publicPanelClass} data-testid="public-foundation-pending">
          <h2 className="font-waia-serif text-waia-fg text-xl">Allocation awaiting confirmation</h2>
          <p className="text-waia-fg-muted mt-3 text-sm leading-relaxed">
            No current allocation is published until the budget and balance reconciliation are both
            complete and current.
          </p>
        </section>
      )}
    </PublicPageShell>
  );
}
