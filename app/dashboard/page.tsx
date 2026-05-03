import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import {
  DEFAULT_DASHBOARD_IDENTITY_LABEL,
  DEFAULT_READINESS_INPUT,
  DEFAULT_TWIN_DIALOGUE_SIGNALS,
} from "@/lib/dashboard/readiness-snapshot-default";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "AI-Twin dashboard workspace.",
};

export default function DashboardPage() {
  const model = buildDashboardViewModel(
    DEFAULT_READINESS_INPUT,
    DEFAULT_TWIN_DIALOGUE_SIGNALS,
    DEFAULT_DASHBOARD_IDENTITY_LABEL,
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      <DashboardSidebar identityLabel={model.identityLabel} />
      <DashboardShell model={model} />
    </div>
  );
}
