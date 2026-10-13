import type { Metadata } from "next";

import { TraderWorkspace } from "@/components/trader/trader-workspace";
import { buildModuleUrl } from "@/lib/hosts/resolve";

export const metadata: Metadata = {
  title: "AI-TRADER",
  description: "AI-TRADER user dashboard — account, portfolio, activity and system posture.",
};

export default function TraderDashboardPage() {
  return <TraderWorkspace signInHref={buildModuleUrl("trader", "/")} />;
}
