import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import { loadDashboardPageDataForUser } from "@/lib/dashboard/dashboard-readiness-source";
import type { DashboardTwinDialogueInitialTurn } from "@/lib/dashboard/types";
import type { TwinDialogueMemoryRow } from "@/lib/twin-persistence/loader";

function isUserOrAssistantRole(
  row: TwinDialogueMemoryRow,
): row is TwinDialogueMemoryRow & { role: "user" | "assistant" } {
  return row.role === "user" || row.role === "assistant";
}

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

  const { payload, dialogueTurns, diaryEntries } = await loadDashboardPageDataForUser(userId);
  const initialTwinDialogueTurns: DashboardTwinDialogueInitialTurn[] = dialogueTurns
    .filter(isUserOrAssistantRole)
    .map((t) => ({ id: t.id, role: t.role, text: t.content }));
  const initialDiaryEntries = diaryEntries.map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
  }));
  const model = {
    ...buildDashboardViewModel(
      payload.readinessInput,
      payload.twinSignals,
      payload.identityLabel,
      initialTwinDialogueTurns,
    ),
    initialDiaryEntries,
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      <DashboardSidebar identityLabel={model.identityLabel} />
      <DashboardShell model={model} />
    </div>
  );
}
