import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DashboardSidebarProps = {
  identityLabel: string;
};

export function DashboardSidebar({ identityLabel }: DashboardSidebarProps) {
  return (
    <aside
      data-testid="dashboard-sidebar"
      aria-label="Dashboard sidebar"
      className="flex w-full shrink-0 flex-col gap-6 border-border border-r bg-muted/40 p-6 sm:w-56 md:w-64"
    >
      <div data-testid="dashboard-sidebar-brand" className="text-lg font-semibold tracking-tight">
        WAIA
      </div>
      <div className="text-sm">
        <p className="text-muted-foreground text-xs uppercase tracking-wide">Signed in</p>
        <p data-testid="dashboard-sidebar-identity" className="mt-1 font-medium wrap-break-word">
          {identityLabel}
        </p>
      </div>
      <div className="mt-auto pt-8">
        <Link
          data-testid="dashboard-sidebar-sign-out"
          href="/"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex w-full justify-center")}
        >
          Sign out
        </Link>
      </div>
    </aside>
  );
}
