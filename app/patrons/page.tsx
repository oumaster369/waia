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
  formatPublicShare,
} from "@/lib/landing/public-format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WAIA Patrons",
  description: "The public record of confirmed financial participation in WAIA.",
};

const cellClass = "border-b border-waia-divider px-4 py-3 align-top text-waia-fg-muted";
const headClass =
  "border-b border-waia-divider bg-waia-elevated px-4 py-3 text-xs font-semibold tracking-wide text-waia-fg-subtle uppercase";

export default async function PatronsPage() {
  const projection = await readPublicTreasuryForView();
  const patrons = projection?.patrons;
  const publishedRecord =
    patrons?.status === "published" &&
    patrons.totalContributedAmountMicros !== null &&
    patrons.currency !== null
      ? patrons
      : null;

  return (
    <PublicPageShell
      eyebrow="Public contribution record"
      title="Patrons"
      intro="People who help keep WAIA alive."
    >
      {!projection ? (
        <section data-testid="public-patrons-unavailable" className={publicPanelClass}>
          <h2 className="font-waia-serif text-waia-fg text-xl">Temporarily unavailable</h2>
          <p className="text-waia-fg-muted mt-3 max-w-2xl leading-relaxed">
            The public contribution record cannot be loaded right now. No private contribution data
            is shown as a fallback.
          </p>
        </section>
      ) : !publishedRecord ? (
        <section data-testid="public-patrons-pending" className={publicPanelClass}>
          <h2 className="font-waia-serif text-waia-fg text-xl">Not yet published</h2>
          <p className="text-waia-fg-muted mt-3 max-w-2xl leading-relaxed">
            The first complete public contribution record is still awaiting publication.
          </p>
        </section>
      ) : (
        <section data-testid="public-patrons-record" className="flex flex-col gap-6">
          <div className="text-waia-fg-muted flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p>
              Confirmed contributions:{" "}
              <span className="text-waia-fg font-mono tabular-nums">
                {formatPublicMoney(
                  publishedRecord.totalContributedAmountMicros,
                  publishedRecord.currency,
                )}
              </span>
            </p>
            {publishedRecord.lastUpdatedAt ? (
              <p className="text-waia-fg-subtle text-xs">
                Updated {formatPublicDateTime(publishedRecord.lastUpdatedAt)}
              </p>
            ) : null}
          </div>

          {publishedRecord.patrons.length === 0 && publishedRecord.privateSupport === null ? (
            <p data-testid="public-patrons-empty" className={publicPanelClass}>
              No confirmed contribution rows have been published.
            </p>
          ) : (
            <div className={publicTableWrapClass}>
              <table className={publicTableClass}>
                <caption className="sr-only">Published WAIA patron contributions</caption>
                <thead>
                  <tr>
                    <th className={headClass} scope="col">
                      Patron
                    </th>
                    <th className={headClass} scope="col">
                      Contributed
                    </th>
                    <th className={headClass} scope="col">
                      Share
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {publishedRecord.patrons.map((patron, index) => (
                    <tr key={patron.displayName + ":" + index}>
                      <th className={cellClass + " text-waia-fg font-medium"} scope="row">
                        {patron.displayName}
                      </th>
                      <td className={cellClass + " font-mono tabular-nums"}>
                        {formatPublicMoney(patron.contributedAmountMicros, patron.currency)}
                      </td>
                      <td className={cellClass + " font-mono tabular-nums"}>
                        {formatPublicShare(patron.share.partsPerMillion)}
                      </td>
                    </tr>
                  ))}
                  {publishedRecord.privateSupport ? (
                    <tr>
                      <th className={cellClass + " text-waia-fg font-medium"} scope="row">
                        Private &amp; anonymous support
                      </th>
                      <td className={cellClass + " font-mono tabular-nums"}>
                        {formatPublicMoney(
                          publishedRecord.privateSupport.contributedAmountMicros,
                          publishedRecord.privateSupport.currency,
                        )}
                      </td>
                      <td className={cellClass + " font-mono tabular-nums"}>
                        {formatPublicShare(publishedRecord.privateSupport.share.partsPerMillion)}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          )}

          <p className="border-waia-divider text-waia-fg-muted border-t pt-6 text-sm leading-relaxed">
            Share shows financial participation only. It does not grant ownership, governance power
            or voting weight.
          </p>
        </section>
      )}
    </PublicPageShell>
  );
}
