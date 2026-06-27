import type { Metadata } from "next";

import { TraderWorkspace } from "@/components/trader/trader-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI-TRADER",
  description: "AI-TRADER workspace — HTX connect and account status.",
};

export default function TraderDashboardPage() {
  return <TraderWorkspace />;
}
