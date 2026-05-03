import type { Metadata } from "next";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { DEFAULT_DEMO_SNAPSHOT } from "@/components/dashboard/types";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "AI-Twin dashboard workspace.",
};

export default function DashboardPage() {
  const snapshot = DEFAULT_DEMO_SNAPSHOT;

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      <DashboardSidebar identityLabel={snapshot.identityLabel} />
      <DashboardShell snapshot={snapshot} />
    </div>
  );
}
