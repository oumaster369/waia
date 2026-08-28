import Link from "next/link";

import { SidebarSignOut } from "@/components/dashboard/sidebar-sign-out";

export type DashboardSidebarProps = {
  identityLabel: string;
  traderEntryHref?: string | null;
  breathActive?: boolean;
};

export function DashboardSidebar({
  identityLabel,
  traderEntryHref,
  breathActive = false,
}: DashboardSidebarProps) {
  return (
    <aside
      data-testid="dashboard-sidebar"
      aria-label="Dashboard sidebar"
      className="border-border bg-muted/40 flex w-full shrink-0 flex-col gap-6 border-r p-6 sm:w-56 md:w-64"
    >
      <div data-testid="dashboard-sidebar-brand" className="text-lg font-semibold tracking-tight">
        WAIA
      </div>
      <Link
        data-testid="dashboard-sidebar-breath-link"
        href="/dashboard/breath"
        aria-current={breathActive ? "page" : undefined}
        className="rounded-xl border border-[#c9a96e]/60 bg-[linear-gradient(135deg,rgba(201,169,110,0.24),rgba(201,169,110,0.08))] px-4 py-3 text-center text-xs font-semibold tracking-[0.12em] text-[#8b6a2f] shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_8px_24px_rgba(139,106,47,0.12)] transition hover:border-[#c9a96e] hover:bg-[#c9a96e]/25"
      >
        BREATH OF WAIA
      </Link>
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
