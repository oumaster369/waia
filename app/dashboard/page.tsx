import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import { getDashboardReadinessPayloadForUser } from "@/lib/dashboard/dashboard-readiness-source";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "AI-Twin dashboard workspace.",
};

export default async function DashboardPage() {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    redirect("/");
  }

  const payload = await getDashboardReadinessPayloadForUser(userId);
  const model = buildDashboardViewModel(
    payload.readinessInput,
    payload.twinSignals,
    payload.identityLabel,
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      <DashboardSidebar identityLabel={model.identityLabel} />
      <DashboardShell model={model} />
    </div>
  );
}
