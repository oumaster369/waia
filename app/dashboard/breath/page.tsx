import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardBreathWorkspace } from "@/components/dashboard/breath-workspace";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildModuleUrl } from "@/lib/hosts/resolve";
import { readPublicTreasuryForView } from "@/lib/landing/public-data";
import { readPublishedSupportAddress } from "@/lib/landing/support-address";
import { hasTraderAccessForUser } from "@/lib/trader/access-gate";
import { readProfileForSessionUser } from "@/lib/waia-core/profiles/runtime";
import { readSelfContributionRecordForUser } from "@/lib/waia-core/treasury/contributions/self-record";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Breath of WAIA — Dashboard",
  description: "Private WAIA contribution workspace.",
};

export default async function DashboardBreathPage() {
  const userId = await getOptionalSessionUserId();
  if (!userId) redirect("/#register");

  const [profile, record, projection, traderAccess] = await Promise.all([
    readProfileForSessionUser(userId),
    readSelfContributionRecordForUser(userId),
    readPublicTreasuryForView(),
    hasTraderAccessForUser(userId),
  ]);
  if (!profile) redirect("/dashboard");
  const traderEntryHref = traderAccess ? buildModuleUrl("trader", "/trader") : null;
  const accountingCurrency =
    projection?.patrons.currency ?? projection?.breath.availableCurrency ?? "USD";

  return (
    <div className="bg-background flex min-h-screen w-full flex-col md:flex-row">
      <DashboardSidebar
        identityLabel={profile.displayName}
        traderEntryHref={traderEntryHref}
        breathActive
      />
      <DashboardBreathWorkspace
        displayName={profile.displayName}
        support={readPublishedSupportAddress()}
        record={record}
        accountingCurrency={accountingCurrency}
      />
    </div>
  );
}
