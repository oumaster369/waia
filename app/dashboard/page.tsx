import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { getDb } from "@/db/client";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { buildDashboardViewModel } from "@/lib/dashboard/build-dashboard-model";
import type { DashboardTwinDialogueInitialTurn } from "@/lib/dashboard/types";
import { getDashboardReadinessPayloadForUser } from "@/lib/dashboard/dashboard-readiness-source";
import {
  listTwinDialogueTurnsForUser,
  type TwinDialogueMemoryRow,
} from "@/lib/twin-persistence/loader";

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

  const payload = await getDashboardReadinessPayloadForUser(userId);
  const memoryRows = listTwinDialogueTurnsForUser(getDb(), userId);
  const initialTwinDialogueTurns: DashboardTwinDialogueInitialTurn[] = memoryRows
    .filter(isUserOrAssistantRole)
    .map((t) => ({ id: t.id, role: t.role, text: t.content }));
  const model = buildDashboardViewModel(
    payload.readinessInput,
    payload.twinSignals,
    payload.identityLabel,
    initialTwinDialogueTurns,
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-background md:flex-row">
      <DashboardSidebar identityLabel={model.identityLabel} />
      <DashboardShell model={model} />
    </div>
  );
}
