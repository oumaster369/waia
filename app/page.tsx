import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { LandingPageContent } from "@/components/landing/landing-page-content";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildModuleUrl, isModuleHost } from "@/lib/hosts/resolve";
import { OAUTH_ERROR_QUERY } from "@/lib/oauth/oauth-error-codes";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";

export default async function LandingPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const hdrs = await headers();
  const uid = await getOptionalSessionUserId();

  if (isModuleHost(hdrs, "trader")) {
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

  return <LandingPageContent initialOauthErrorCode={initialOauthErrorCode ?? null} />;
}
