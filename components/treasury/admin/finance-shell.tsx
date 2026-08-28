"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { WaiaAdminModuleNav } from "@/components/admin/waia-admin-module-nav";
import { cn } from "@/lib/utils";
import { financeHref } from "@/lib/treasury-admin/org";
import { SidebarSignOut } from "@/components/dashboard/sidebar-sign-out";
import { FinanceOrgProvider, useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { FinanceAssistant } from "@/components/treasury/admin/finance-assistant";
import { FinanceOrgPicker } from "@/components/treasury/admin/org-picker";

const PRIMARY_NAV = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/transactions", label: "Transactions" },
  { href: "/finance/budgets", label: "Budget" },
] as const;

const REFERENCE_NAV = [
  { href: "/finance/counterparties", label: "Counterparties" },
  { href: "/finance/accounts", label: "Accounts" },
  { href: "/finance/projects", label: "Projects" },
] as const;

const OPERATIONS_NAV = [{ href: "/finance/wallet", label: "Wallet" }] as const;

function FinanceNav() {
  const pathname = usePathname();
  const { organizationId } = useFinanceOrg();
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="finance-nav">
      <nav aria-label="Finance primary" className="flex flex-wrap gap-2">
        {PRIMARY_NAV.map((item) => {
          const active =
            item.href === "/finance" ? pathname === "/finance" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={financeHref(item.href, organizationId)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm font-medium",
                active ? "border-foreground/40 bg-muted/50" : "border-border hover:bg-muted/20",
              )}
              data-nav-level="primary"
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <span aria-hidden="true" className="bg-border mx-1 hidden h-6 w-px sm:block" />
      <nav aria-label="Finance reference data" className="flex flex-wrap gap-1.5">
        {REFERENCE_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={financeHref(item.href, organizationId)}
              className={cn(
                "text-muted-foreground hover:bg-muted/20 hover:text-foreground rounded-md border border-dashed px-2.5 py-1.5 text-xs",
                active && "border-foreground/30 bg-muted/30 text-foreground border-solid",
              )}
              data-nav-level="secondary"
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <nav aria-label="Finance operations" className="flex flex-wrap gap-1.5">
        {OPERATIONS_NAV.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={financeHref(item.href, organizationId)}
              className={cn(
                "text-muted-foreground hover:bg-muted/20 hover:text-foreground rounded-md px-2.5 py-1.5 text-xs",
                active && "bg-muted/30 text-foreground",
              )}
              data-nav-level="secondary"
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function FinanceShellInner({
  children,
  moduleAccess,
}: {
  children: React.ReactNode;
  moduleAccess: { finance: boolean; hr: boolean };
}) {
  return (
    <div className="mx-auto grid min-h-screen max-w-7xl gap-8 px-4 py-8 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">WAIA Admin</p>
              <h1 className="text-2xl font-medium">Finance</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                A clear view of WAIA’s money: what is available, what moved, and what is planned.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link
                className="text-muted-foreground underline-offset-4 hover:underline"
                href="/waia-admin"
              >
                Admin home
              </Link>
              <Link
                className="text-muted-foreground underline-offset-4 hover:underline"
                href="/dashboard"
              >
                User dashboard
              </Link>
              <div className="w-24">
                <SidebarSignOut />
              </div>
            </div>
          </div>
          <FinanceOrgPicker />
          <FinanceNav />
        </header>
        <main className="flex-1">{children}</main>
        <FinanceAssistant />
      </div>
      <WaiaAdminModuleNav finance={moduleAccess.finance} hr={moduleAccess.hr} active="finance" />
    </div>
  );
}

export function FinanceShell({
  children,
  moduleAccess,
}: {
  children: React.ReactNode;
  moduleAccess: { finance: boolean; hr: boolean };
}) {
  return (
    <FinanceOrgProvider>
      <FinanceShellInner moduleAccess={moduleAccess}>{children}</FinanceShellInner>
    </FinanceOrgProvider>
  );
}
