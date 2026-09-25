import { AdminQueryProvider } from "@/components/trader/admin-console/data/query-provider";
import { AdminConsoleShell } from "@/components/trader/admin-console/shell/admin-console-shell";
import { AdminReadContextProvider } from "@/components/trader/admin-console/data/read-context";
import { notFound, redirect } from "next/navigation";
import { createProductionAdminRouteDeps } from "@/lib/trader/admin-route-deps";
import { authorizeAdminRoute } from "@/lib/trader/admin-route-shared";
import { personalOrganizationIdFromUserId } from "@/lib/waia-core/ids";

/**
 * Page admission is additional to, never a replacement for, API authorization.
 * Use verified identity without session-time provisioning or trader bootstrap.
 */
export const dynamic = "force-dynamic";

export default async function TraderAdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const deps = createProductionAdminRouteDeps();
  const userId = await deps.getUserId();
  if (!userId) redirect("/");
  let runtime;
  try {
    const auth = await authorizeAdminRoute(
      { ...deps, getUserId: async () => userId },
      personalOrganizationIdFromUserId(userId),
      "admin.audit.read",
    );
    runtime = auth.runtime;
    if (!auth.ok) notFound();
  } finally {
    await deps.disposeRuntimeDb(runtime);
  }
  return (
    <div className="dark bg-waia-field text-waia-fg-primary min-h-dvh w-full font-sans">
      <AdminQueryProvider>
        <AdminReadContextProvider>
          <AdminConsoleShell>{children}</AdminConsoleShell>
        </AdminReadContextProvider>
      </AdminQueryProvider>
    </div>
  );
}
