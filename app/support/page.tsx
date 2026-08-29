import type { Metadata } from "next";
import Link from "next/link";

import { AnonymousSupportPanel } from "@/components/public/anonymous-support-panel";
import { PublicPageShell, publicPanelClass } from "@/components/public/public-page-shell";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { readPublishedSupportAddress } from "@/lib/landing/support-address";
import { readProfileForSessionUser } from "@/lib/waia-core/profiles/runtime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Support Breath of WAIA",
  description: "The official public crypto support channel for Breath of WAIA.",
};

export default async function SupportBreathPage() {
  const support = readPublishedSupportAddress();
  const userId = await getOptionalSessionUserId();
  const profile = userId ? await readProfileForSessionUser(userId) : null;

  return (
    <PublicPageShell
      eyebrow="Support WAIA"
      title="Keep WAIA Breathing"
      intro="Help fund the people, infrastructure and services that keep WAIA working."
    >
      <AnonymousSupportPanel support={support} testId="public-support-payment" />

      <section data-testid="public-support-named" className={publicPanelClass}>
        <h2 className="font-waia-serif text-waia-fg text-2xl">Appear in the Patrons record</h2>
        <p className="text-waia-fg-muted mt-3 max-w-2xl text-sm leading-relaxed">
          Sign in, confirm the public identity you want attached to the contribution, and prepare an
          exact payment instruction. Send precisely the generated amount to the official address.
          TronGrid can then match the receipt to you without publishing private wallet data.
        </p>
        <div className="border-waia-divider mt-6 border-t pt-6">
          {profile ? (
            <div className="space-y-3">
              <p className="text-waia-fg-muted text-sm">
                You are signed in as {profile.displayName}. Open Breath of WAIA in your private
                workspace to prepare the exact payment and see your confirmed contribution history.
              </p>
              <Link
                className="text-waia-accent-warm underline underline-offset-4"
                href="/dashboard/breath"
              >
                Open Breath of WAIA in my dashboard →
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-waia-fg-muted text-sm">
                Sign in with your WAIA account to prepare a named contribution. Anonymous support
                remains available above. After sign-in, use the gold BREATH OF WAIA button in your
                dashboard.
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
