import { redirect } from "next/navigation";

import { WaiaAdminModuleNav } from "@/components/admin/waia-admin-module-nav";
import { SidebarSignOut } from "@/components/dashboard/sidebar-sign-out";
import { HrWorkspace } from "@/components/hr/hr-workspace";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { resolveWaiaAdminAccess } from "@/lib/waia-core/permissions/waia-admin";

export const dynamic = "force-dynamic";

export default async function HrPage() {
  const userId = await getOptionalSessionUserId();
  if (!userId) redirect("/");
  let runtime;
  let access = { superAdmin: false, finance: false, hr: false };
  try {
    runtime = await getWaiaRuntimeDb();
    access = await resolveWaiaAdminAccess(runtime, userId);
  } finally {
    await disposeWaiaRuntimeDb(runtime);
  }
  if (!access.hr) {
    return (
      <WaiaSurface className="mx-auto mt-16 max-w-xl p-6">
        HR admin permission is required.
      </WaiaSurface>
    );
  }
  return (
    <main className="bg-background min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA Admin</p>
              <h1 className="mt-1 text-3xl font-medium">HR</h1>
              <p className="text-muted-foreground mt-2 text-sm">
                A clear, auditable funnel from first application through work.
              </p>
            </div>
            <div className="w-24">
              <SidebarSignOut />
            </div>
          </header>
          <HrWorkspace />
        </div>
        <WaiaAdminModuleNav finance={access.finance} hr={access.hr} active="hr" />
      </div>
    </main>
  );
}
