"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { financeHref } from "@/lib/treasury-admin/org";
import { FinanceOrgProvider, useFinanceOrg } from "@/components/treasury/admin/finance-org-context";
import { FinanceOrgPicker } from "@/components/treasury/admin/org-picker";

const NAV = [
  { href: "/finance", label: "Overview" },
  { href: "/finance/transactions", label: "Transactions" },
  { href: "/finance/budgets", label: "Budgets" },
  { href: "/finance/funding-needs", label: "Funding needs" },
  { href: "/finance/commitments", label: "Commitments" },
  { href: "/finance/evidence", label: "Evidence" },
  { href: "/finance/preview", label: "Publication preview" },
] as const;

function FinanceNav() {
  const pathname = usePathname();
  const { organizationId } = useFinanceOrg();
  return (
    <nav aria-label="Finance" className="flex flex-wrap gap-2" data-testid="finance-nav">
      {NAV.map((item) => {
        const active =
          item.href === "/finance" ? pathname === "/finance" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={financeHref(item.href, organizationId)}
            className={cn(
              "rounded-md border px-3 py-1.5 text-sm",
              active ? "border-foreground/40 bg-muted/40" : "border-border hover:bg-muted/20",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function FinanceShellInner({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="space-y-4">
        <div>
          <p className="text-muted-foreground text-xs uppercase tracking-wide">WAIA Treasury</p>
          <h1 className="text-2xl font-medium">Finance</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Human review of provenance, accounting meaning, evidence, verification, and publication.
            Public and private facts stay visually separate.
          </p>
        </div>
        <FinanceOrgPicker />
        <FinanceNav />
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

export function FinanceShell({ children }: { children: React.ReactNode }) {
  return (
    <FinanceOrgProvider>
      <FinanceShellInner>{children}</FinanceShellInner>
    </FinanceOrgProvider>
  );
}
