import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import { getDashboardReadinessPayload } from "@/lib/dashboard/dashboard-readiness-source";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "AI-Twin dashboard workspace.",
};

export default async function DashboardPage() {
  // Loads the same snapshot as GET /api/dashboard/readiness via getDashboardReadinessPayload (single server source).
  const payload = await getDashboardReadinessPayload();
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
