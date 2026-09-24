"use client";

import { Command, CommandInput, CommandItem, CommandList } from "cmdk";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";

import { QUICK_ANSWERS } from "@/lib/trader/admin-console/assistant/quick-answers";
import { AssistantPanel } from "@/components/trader/admin-console/assistant/assistant-panel";
import { EmergencyStopDialog } from "@/components/trader/admin-console/primitives/emergency-stop-dialog";
import { MarketStrip } from "@/components/trader/admin-console/shell/market-strip";
import { StatusBar } from "@/components/trader/admin-console/shell/status-bar";
import { RU } from "@/components/trader/admin-console/i18n/ru";
import { TraderSignOut } from "@/components/trader/trader-sign-out";
import { cn } from "@/lib/utils";

const NAV_KEY = "waia-admin-console-nav";

const LINKS = [
  { href: "/admin", label: RU.sections.overview },
  { href: "/admin/accounts", label: RU.sections.accounts },
  { href: "/admin/orders", label: RU.sections.orders },
  { href: "/admin/clients", label: RU.sections.clients },
  { href: "/admin/strategies", label: RU.sections.strategies },
  { href: "/admin/research", label: RU.sections.research },
  { href: "/admin/errors", label: RU.sections.errors },
  { href: "/admin/system", label: RU.sections.system },
] as const;

export function AdminConsoleShell({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(
    () => typeof window !== "undefined" && window.localStorage.getItem(NAV_KEY) === "1",
  );
  const [palette, setPalette] = React.useState(false);
  const [emergency, setEmergency] = React.useState(false);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div lang="ru" className="grid gap-4 md:grid-cols-[auto_1fr_auto]">
      <div className="md:col-span-3">
        <p className="text-muted-foreground text-sm">AI-TRADER · Консоль администратора</p>
        <TraderSignOut />
      </div>
      <nav
        aria-label={RU.navLabel}
        data-collapsed={collapsed ? "true" : "false"}
        className={cn("flex flex-col gap-1", collapsed ? "w-16" : "w-[216px]")}
      >
        <button
          type="button"
          aria-pressed={collapsed}
          onClick={() => {
            const next = !collapsed;
            setCollapsed(next);
            window.localStorage.setItem(NAV_KEY, next ? "1" : "0");
          }}
        >
          {collapsed ? "Развернуть меню" : "Свернуть меню"}
        </button>
        <button type="button" onClick={() => setPalette(true)}>
          Поиск
        </button>
        {LINKS.map((link) => {
          const active =
            link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={cn("rounded-md px-3 py-2 text-sm", active && "bg-muted")}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0">
        <button type="button" onClick={() => setEmergency(true)}>
          {RU.emergency.open}
        </button>
        <MarketStrip />
        <StatusBar />
        {children}
      </div>
      <aside aria-label="Правая панель">
        <AssistantPanel
          enabled={false}
          answers={QUICK_ANSWERS.map((answer) => ({ id: answer.id, title: answer.title }))}
        />
        {right}
      </aside>
      {palette ? (
        <Command label="Поиск по консоли">
          <CommandInput placeholder="Раздел" />
          <CommandList>
            {LINKS.map((link) => (
              <CommandItem key={link.href} onSelect={() => router.push(link.href)}>
                {link.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      ) : null}
      <EmergencyStopDialog
        open={emergency}
        onClose={() => setEmergency(false)}
        expectedStateVersion={null}
        onSubmit={() => undefined}
      />
    </div>
  );
}
