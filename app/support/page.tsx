import type { Metadata } from "next";
import Link from "next/link";

import { ContributionIntentForm } from "@/components/public/contribution-intent-form";
import { PublicPageShell, publicPanelClass } from "@/components/public/public-page-shell";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { readProfileForSessionUser } from "@/lib/waia-core/profiles/runtime";
import { isValidTronAddress, tronScanAddressUrl } from "@/lib/treasury-admin/explorer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support Breath of WAIA",
  description: "The official public crypto support channel for Breath of WAIA.",
};

function publishedSupportAddress(): string | null {
  const value = process.env.WAIA_PUBLIC_SUPPORT_USDT_TRC20_ADDRESS?.trim() ?? "";
  return isValidTronAddress(value) ? value : null;
}

export default async function SupportBreathPage() {
  const address = publishedSupportAddress();
  const explorerUrl = address ? tronScanAddressUrl(address) : null;
  const userId = await getOptionalSessionUserId();
  const profile = userId ? await readProfileForSessionUser(userId) : null;

  return (
    <PublicPageShell
      eyebrow="Support WAIA"
      title="Keep WAIA Breathing"
      intro="Help fund the people, infrastructure and services that keep WAIA working."
    >
      {address ? (
        <section data-testid="public-support-payment" className={`${publicPanelClass} space-y-5`}>
          <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.14em] uppercase">
            USDT · TRON (TRC-20)
          </p>
          <p
            data-testid="public-support-address"
            className="text-waia-fg mt-4 font-mono text-lg leading-relaxed break-all"
          >
            {address}
          </p>
          <p className="text-waia-fg-muted mt-4 max-w-2xl text-sm leading-relaxed">
            For an anonymous contribution, send any amount of USDT on the TRON network directly to
            this address. It will be recorded as private or anonymous support after Human review.
          </p>
          {explorerUrl ? (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-waia-accent-warm mt-5 inline-flex text-sm underline underline-offset-4"
            >
              Verify the official address in TronScan →
            </a>
          ) : null}
        </section>
      ) : (
        <section data-testid="public-support-pending" className={publicPanelClass}>
          <h2 className="font-waia-serif text-waia-fg text-xl">
            Payment address not yet published
          </h2>
          <p className="text-waia-fg-muted mt-3 max-w-2xl leading-relaxed">
            The support page is ready, but the governed WAIA USDT TRC-20 address has not been
            published. Do not send funds to an address received through another channel.
          </p>
        </section>
      )}

      <section data-testid="public-support-named" className={publicPanelClass}>
        <h2 className="font-waia-serif text-waia-fg text-2xl">Appear in the Patrons record</h2>
        <p className="text-waia-fg-muted mt-3 max-w-2xl text-sm leading-relaxed">
          Sign in, confirm the public identity you want attached to the contribution, and prepare an
          exact payment instruction. Send precisely the generated amount to the official address.
          TronGrid can then match the receipt to you without publishing private wallet data.
        </p>
        <div className="border-waia-divider mt-6 border-t pt-6">
          {profile ? (
            <ContributionIntentForm displayName={profile.displayName} />
          ) : (
            <div className="space-y-3">
              <p className="text-waia-fg-muted text-sm">
                Sign in with your WAIA account to prepare a named contribution. Anonymous support
                remains available above.
              </p>
              <Link
                className="text-waia-accent-warm underline underline-offset-4"
                href="/#register"
              >
                Sign in or create an account →
              </Link>
            </div>
          )}
        </div>
      </section>
    </PublicPageShell>
  );
}
