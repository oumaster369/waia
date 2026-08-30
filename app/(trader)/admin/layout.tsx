import { redirect } from "next/navigation";

import { AdminShell } from "@/components/trader/admin/admin-shell";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { assertAdminPermission } from "@/lib/trader/admin-route-shared";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

export default async function TraderAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const userId = await getOptionalSessionUserId();
  if (!userId) {
    redirect("/");
  }

  let runtime;
  try {
    runtime = await getWaiaRuntimeDb();
    const contextOrgId = personalOrganizationIdFromUserId(userId);
    const check = await assertAdminPermission(runtime, userId, contextOrgId, "admin.audit.read");
    if (!check.allowed) {
      redirect("/trader");
    }
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }

  return <AdminShell>{children}</AdminShell>;
}
