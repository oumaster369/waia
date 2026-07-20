"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as React from "react";

import { WaiaSurface } from "@/components/waia/waia-surface";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/kill-switches", label: "Kill switches" },
  { href: "/admin/live-enable", label: "Live enable" },
  { href: "/admin/strategy-promotions", label: "Strategy promotions" },
  { href: "/admin/billing", label: "Billing" },
  { href: "/admin/audit", label: "Audit" },
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="space-y-2">
        <p className="text-muted-foreground text-sm">AI-TRADER · Admin console</p>
        <h1 className="text-2xl font-semibold tracking-tight">Operator admin</h1>
      </header>

      <WaiaSurface variant="raised" className="flex flex-wrap gap-2 p-2">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors",
                active ? "bg-primary text-primary-foreground" : "hover:bg-muted/60 text-foreground",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </WaiaSurface>

      {children}
    </div>
  );
}
