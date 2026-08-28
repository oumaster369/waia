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
const ADAMAR_PUBLIC_SITE = "https://oumaster.com";

export default async function PatronsPage() {
  const projection = await readPublicTreasuryForView();
  const patrons = projection?.patrons;
  const publishedRecord =
    patrons?.status === "published" &&
    patrons.totalContributedAmountMicros !== null &&
    patrons.currency !== null
      ? patrons
      : null;
  const rankedRows = publishedRecord
    ? [
        ...publishedRecord.patrons.map((patron) => ({
          ...patron,
          publicSiteUrl:
            patron.publicSiteUrl ??
            (patron.displayName.trim().toLocaleLowerCase("en-US") === "adamar"
              ? ADAMAR_PUBLIC_SITE
              : null),
        })),
        ...(publishedRecord.privateSupport
          ? [
              {
                displayName: "Anonymous Patrons",
                publicSiteUrl: null,
                twinProfileUrl: null,
                contributedAmountMicros: publishedRecord.privateSupport.contributedAmountMicros,
                currency: publishedRecord.privateSupport.currency,
                share: publishedRecord.privateSupport.share,
              },
            ]
          : []),
      ].sort((a, b) => {
        const amountA = BigInt(a.contributedAmountMicros);
        const amountB = BigInt(b.contributedAmountMicros);
        if (amountA !== amountB) return amountA > amountB ? -1 : 1;
        return a.displayName.localeCompare(b.displayName);
      })
    : [];

  return (
    <PublicPageShell
      eyebrow="Public contribution record"
      title="Patrons"
      intro="Thank you to everyone helping WAIA breathe. We keep this record so that, when the time is right, WAIA can decide how to thank each patron — perhaps through future WAIA Core shares, perhaps in another form. Nothing is promised today; the contribution record is kept faithfully."
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

          {rankedRows.length === 0 ? (
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
                      Profile
                    </th>
                    <th className={headClass} scope="col">
                      Website / social
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
                  {rankedRows.map((patron, index) => (
                    <tr key={patron.displayName + ":" + index}>
                      <th className={cellClass + " text-waia-fg font-medium"} scope="row">
                        {patron.displayName}
                      </th>
                      <td className={cellClass}>
                        {patron.twinProfileUrl ? (
                          <a
                            className="underline underline-offset-4"
                            href={patron.twinProfileUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            AI-Twin profile
                          </a>
                        ) : (
                          <span className="text-waia-fg-subtle">Reserved</span>
                        )}
                      </td>
                      <td className={cellClass}>
                        {patron.publicSiteUrl ? (
                          <a
                            className="underline underline-offset-4"
                            href={patron.publicSiteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open link
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={cellClass + " font-mono tabular-nums"}>
                        {formatPublicMoney(patron.contributedAmountMicros, patron.currency)}
                      </td>
                      <td className={cellClass + " font-mono tabular-nums"}>
                        {formatPublicShare(patron.share.partsPerMillion)}
                      </td>
                    </tr>
                  ))}
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
