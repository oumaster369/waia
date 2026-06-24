import { SidebarSignOut } from "@/components/dashboard/sidebar-sign-out";

export type DashboardSidebarProps = {
  identityLabel: string;
  traderEntryHref?: string | null;
};

export function DashboardSidebar({ identityLabel, traderEntryHref }: DashboardSidebarProps) {
  return (
    <aside
      data-testid="dashboard-sidebar"
      aria-label="Dashboard sidebar"
      className="border-border bg-muted/40 flex w-full shrink-0 flex-col gap-6 border-r p-6 sm:w-56 md:w-64"
    >
      <div data-testid="dashboard-sidebar-brand" className="text-lg font-semibold tracking-tight">
        WAIA
      </div>
      <div className="text-sm">
        <p className="text-muted-foreground text-xs tracking-wide uppercase">Signed in</p>
        <p data-testid="dashboard-sidebar-identity" className="mt-1 font-medium wrap-break-word">
          {identityLabel}
        </p>
      </div>
      {traderEntryHref ? (
        <a
          data-testid="dashboard-sidebar-trader-link"
          href={traderEntryHref}
          className="text-sm font-medium underline-offset-4 hover:underline"
        >
          AI-TRADER
        </a>
      ) : null}
      <div className="mt-auto pt-8">
        <SidebarSignOut />
      </div>
    </aside>
  );
}
