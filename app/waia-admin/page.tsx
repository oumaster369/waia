import Link from "next/link";
import { redirect } from "next/navigation";

import { WaiaAdminModuleNav } from "@/components/admin/waia-admin-module-nav";
import { SidebarSignOut } from "@/components/dashboard/sidebar-sign-out";
import { buttonVariants } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";
import { disposeWaiaRuntimeDb, getWaiaRuntimeDb } from "@/db/waia-runtime-db";
import { getOptionalSessionUserId } from "@/lib/auth/session-user";
import { cn } from "@/lib/utils";
import { resolveWaiaAdminAccess } from "@/lib/waia-core/permissions/waia-admin";

export const dynamic = "force-dynamic";

export default async function WaiaAdminPage() {
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

  return (
    <main className="bg-background min-h-screen px-4 py-8 sm:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="flex min-w-0 flex-col gap-8">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-6">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Protected space
              </p>
              <h1 className="mt-1 text-3xl font-medium">WAIA Admin</h1>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
                Administrative modules use the shared WAIA account and explicit module permissions.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                className="text-muted-foreground text-sm underline-offset-4 hover:underline"
                href="/dashboard"
              >
                User dashboard
              </Link>
              <div className="w-24">
                <SidebarSignOut />
              </div>
            </div>
          </header>

          <section aria-labelledby="admin-modules-heading">
            <h2 id="admin-modules-heading" className="text-lg font-medium">
              Administrative modules
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <WaiaSurface
                variant="raised"
                className="space-y-4 p-5"
                data-testid="waia-admin-finance-module"
              >
                <div>
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">Treasury</p>
                  <h3 className="mt-1 text-xl font-medium">Finance</h3>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Transactions, budgets, reference data, wallet observation and public Breath
                    controls.
                  </p>
                </div>
                {access.finance ? (
                  <Link
                    className={cn(buttonVariants({ variant: "default" }), "inline-flex")}
                    href="/finance"
                  >
                    Open Finance
                  </Link>
                ) : (
                  <p className="text-muted-foreground text-sm">
                    Treasury admin permission is required.
                  </p>
                )}
              </WaiaSurface>
              <WaiaSurface
                variant="raised"
                className="space-y-4 p-5"
                data-testid="waia-admin-hr-module"
              >
                <div>
                  <p className="text-muted-foreground text-xs tracking-wide uppercase">People</p>
                  <h3 className="mt-1 text-xl font-medium">HR</h3>
                  <p className="text-muted-foreground mt-2 text-sm">
                    Team applications, accountable owners, status history and internal comments.
                  </p>
                </div>
                {access.hr ? (
                  <Link
                    className={cn(buttonVariants({ variant: "default" }), "inline-flex")}
                    href="/hr"
                  >
                    Open HR
                  </Link>
                ) : (
                  <p className="text-muted-foreground text-sm">HR admin permission is required.</p>
                )}
              </WaiaSurface>
            </div>
          </section>
        </div>
        <WaiaAdminModuleNav finance={access.finance} hr={access.hr} active="home" />
      </div>
    </main>
  );
}
