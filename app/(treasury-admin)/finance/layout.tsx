import { Suspense } from "react";
import { redirect } from "next/navigation";

import { FinanceShell } from "@/components/treasury/admin/finance-shell";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { assertAdminPermission } from "@/lib/waia-core/permissions/admin-http";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

function FinanceForbidden() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <WaiaSurface variant="raised" className="space-y-3 p-6" data-testid="finance-forbidden">
        <h1 className="text-xl font-medium">Access denied</h1>
        <p className="text-sm">
          You do not have permission to access WAIA Finance. Treasury admin read access is required.
        </p>
      </WaiaSurface>
    </div>
  );
}

export default async function FinanceLayout({
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
    const check = await assertAdminPermission(runtime, userId, contextOrgId, "admin.treasury.read");
    if (!check.allowed) {
      return <FinanceForbidden />;
    }
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }

  return (
    <Suspense fallback={<p className="text-muted-foreground p-8 text-sm">Loading Finance…</p>}>
      <FinanceShell>{children}</FinanceShell>
    </Suspense>
  );
}
