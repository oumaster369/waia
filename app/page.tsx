import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LandingPageContent } from "@/components/landing/landing-page-content";
import { TraderLandingPage } from "@/components/trader/public/trader-landing-page";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildModuleUrl, isModuleHost } from "@/lib/hosts/resolve";
import { OAUTH_ERROR_QUERY } from "@/lib/oauth/oauth-error-codes";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { readPublicTreasuryForView } from "@/lib/landing/public-data";

export async function generateMetadata(): Promise<Metadata> {
  const hdrs = await headers();
  if (!isModuleHost(hdrs, "trader")) {
    return {};
  }

  return {
    title: "AI-TRADER",
    description:
      "Evidence-led market intelligence with explicit uncertainty, risk and no-trade outcomes.",
    alternates: { canonical: buildModuleUrl("trader", "/") },
    robots: { index: true, follow: true },
  };
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hdrs = await headers();
  const uid = await getOptionalSessionUserId();
  const isTraderHost = isModuleHost(hdrs, "trader");

  if (isTraderHost) {
    if (uid) {
      const entitled = await hasTraderAccessForUser(uid);
      if (entitled) {
        redirect("/trader");
      }
      redirect(buildModuleUrl("primary", "/dashboard"));
    }
  } else if (uid) {
    redirect("/dashboard");
  }

  const resolved = searchParams ? await searchParams : {};
  const raw = resolved[OAUTH_ERROR_QUERY];
  const initialOauthErrorCode =
    typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;

  if (isTraderHost) {
    return <TraderLandingPage initialOauthErrorCode={initialOauthErrorCode ?? null} />;
  }

  const publicTreasury = await readPublicTreasuryForView();

  return (
    <LandingPageContent
      initialOauthErrorCode={initialOauthErrorCode ?? null}
      publicTreasury={publicTreasury}
    />
  );
}
