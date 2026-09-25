"use client";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "cmdk";
import { ChevronLeft, ChevronRight, CircleStop, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { QUICK_ANSWERS } from "@/lib/trader/admin-console/assistant/quick-answers";
import { AssistantPanel } from "@/components/trader/admin-console/assistant/assistant-panel";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { useAdminRead } from "@/components/trader/admin-console/data/use-admin-read";
import {
  ADMIN_SECTIONS,
  ConsoleBrandIcon,
  sectionForPath,
} from "@/components/trader/admin-console/navigation/sections";
import {
  ConsoleDialog,
  controlClass,
  SectionTabs,
} from "@/components/trader/admin-console/primitives/console-ui";
import { EmergencyWorkflow } from "@/components/trader/admin-console/primitives/emergency-workflow";
import {
  ContextControls,
  type ConsoleCatalogue,
} from "@/components/trader/admin-console/shell/context-controls";
import { MarketStrip } from "@/components/trader/admin-console/shell/market-strip";
import { StatusBar } from "@/components/trader/admin-console/shell/status-bar";
import { TraderSignOut } from "@/components/trader/trader-sign-out";
import { cn } from "@/lib/utils";

const NAV_KEY = "waia-admin-console-nav";
const NAV_EVENT = "waia:admin-navigation-preference";
let temporaryCollapsed = false;
function navigationSnapshot() {
  try {
    return window.localStorage.getItem(NAV_KEY) === "1";
  } catch {
    return temporaryCollapsed;
  }
}
function subscribeNavigation(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(NAV_EVENT, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(NAV_EVENT, listener);
  };
}
export function AdminConsoleShell({
  children,
  right,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  const { pathname, href } = useAdminReadContext();
  const router = useRouter();
  const section = sectionForPath(pathname);
  const catalogueRead = useAdminRead<ConsoleCatalogue>("/api/trader/admin/console/context", {
    context: false,
    intervalMs: 60_000,
  });
  const catalogue = catalogueRead.envelope?.data.clients ? catalogueRead.envelope.data : null;
  const collapsed = React.useSyncExternalStore(
    subscribeNavigation,
    navigationSnapshot,
    () => false,
  );
  const [palette, setPalette] = React.useState(false);
  const [assistant, setAssistant] = React.useState(false);
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
    <div lang="ru" aria-label="Консоль администратора AI-TRADER" className="min-h-dvh md:flex">
      <a
        href="#admin-content"
        className="bg-waia-elevated sr-only z-50 rounded-lg px-4 py-3 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        К содержимому
      </a>
      <aside
        className={cn(
          "border-waia-divider bg-waia-field-mid md:sticky md:top-0 md:flex md:h-dvh md:shrink-0 md:flex-col md:border-r",
          collapsed ? "md:w-20" : "md:w-56",
        )}
      >
        <Link
          href={href("/admin")}
          aria-label="AI-TRADER — обзор"
          className="focus-visible:ring-waia-accent-cool flex h-20 items-center gap-3 px-6 outline-none focus-visible:ring-2 focus-visible:ring-inset"
        >
          <ConsoleBrandIcon
            size={28}
            strokeWidth={1.5}
            className="text-waia-accent-cool shrink-0"
          />
          {collapsed ? null : (
            <span>
              <span className="block text-sm font-bold tracking-[0.12em]">AI-TRADER</span>
              <span className="text-waia-fg-muted mt-1 block text-[10px] tracking-widest uppercase">
                Администрирование
              </span>
            </span>
          )}
        </Link>
        <nav
          aria-label="Консоль администратора AI-TRADER"
          data-collapsed={collapsed ? "true" : "false"}
          className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:overflow-visible md:pt-5"
        >
          {ADMIN_SECTIONS.map((item) => {
            const active = item.id === section.id;
            const Icon = item.icon;
            return (
              <Link
                key={item.id}
                href={href(item.href)}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.title : undefined}
                className={cn(
                  "focus-visible:ring-waia-accent-cool flex min-h-11 shrink-0 items-center gap-3 rounded-lg px-3 text-sm transition-colors outline-none focus-visible:ring-2",
                  active
                    ? "bg-waia-elevated text-waia-fg-primary font-semibold"
                    : "text-waia-fg-muted hover:bg-waia-elevated/50 hover:text-waia-fg-primary",
                )}
              >
                <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
                <span className={collapsed ? "md:sr-only" : ""}>{item.title}</span>
                {active ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "bg-waia-accent-cool ml-auto hidden h-1.5 w-1.5 rounded-full md:block",
                      collapsed && "md:hidden",
                    )}
                  />
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="border-waia-divider mt-auto hidden border-t p-4 md:block">
          <button
            type="button"
            aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
            aria-pressed={collapsed}
            onClick={() => {
              const next = !collapsed;
              temporaryCollapsed = next;
              try {
                window.localStorage.setItem(NAV_KEY, next ? "1" : "0");
              } catch {
                /* Storage is optional. */
              }
              window.dispatchEvent(new Event(NAV_EVENT));
            }}
            className="text-waia-fg-muted hover:bg-waia-elevated focus-visible:outline-waia-accent-cool flex w-full items-center gap-3 rounded-lg p-2 text-xs focus-visible:outline-2"
          >
            {collapsed ? (
              <ChevronRight size={16} />
            ) : (
              <>
                <ChevronLeft size={16} />
                Свернуть меню
              </>
            )}
          </button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="border-waia-divider flex min-h-20 flex-wrap items-center justify-between gap-4 border-b px-4 py-4 lg:px-8">
          <div>
            <p className="text-waia-fg-muted text-[10px] font-medium tracking-[0.16em] uppercase">
              Консоль оператора
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">{section.title}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Поиск по консоли"
              className={`${controlClass} inline-flex items-center gap-2`}
              onClick={() => setPalette(true)}
            >
              <Search size={15} aria-hidden="true" />
              <span className="hidden lg:inline">Перейти</span>
              <kbd className="border-waia-rim text-waia-fg-muted hidden rounded border px-1.5 text-[10px] sm:inline">
                ⌘ / Ctrl K
              </kbd>
            </button>
            <button
              type="button"
              aria-expanded={assistant}
              aria-controls="admin-assistant"
              className={`${controlClass} inline-flex items-center gap-2`}
              onClick={() => setAssistant(!assistant)}
            >
              <Sparkles size={15} aria-hidden="true" />
              <span className="hidden sm:inline">Помощник</span>
            </button>
            <button
              type="button"
              className="border-waia-danger/40 bg-waia-danger/10 text-waia-danger-fg hover:bg-waia-danger/20 focus-visible:ring-waia-danger inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium outline-none focus-visible:ring-2"
              onClick={() => setEmergency(true)}
            >
              <CircleStop size={15} aria-hidden="true" />
              Аварийная остановка
            </button>
            <TraderSignOut locale="ru" />
          </div>
        </header>
        <ContextControls catalogue={catalogue} />
        <MarketStrip />
        <StatusBar release={catalogue?.release} />
        <div className="flex items-start">
          <main id="admin-content" className="min-w-0 flex-1 px-4 pt-5 pb-12 lg:px-8" tabIndex={-1}>
            <p className="text-waia-fg-muted mb-3 text-sm leading-6">{section.description}</p>
            <SectionTabs section={section} />
            {children}
          </main>
          {assistant ? (
            <aside
              id="admin-assistant"
              aria-label="Помощник"
              className="border-waia-divider bg-waia-field-mid fixed inset-y-0 right-0 z-30 w-80 max-w-[90vw] overflow-y-auto border-l p-5 shadow-2xl xl:sticky xl:top-0 xl:z-auto xl:h-dvh xl:shrink-0 xl:shadow-none"
            >
              <div className="mb-5 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles size={16} />
                  Помощник
                </h2>
                <button
                  type="button"
                  aria-label="Закрыть помощника"
                  onClick={() => setAssistant(false)}
                  className="hover:bg-waia-elevated rounded-lg p-1.5"
                >
                  <X size={17} />
                </button>
              </div>
              <AssistantPanel
                enabled={false}
                answers={QUICK_ANSWERS.map((answer) => ({ id: answer.id, title: answer.title }))}
              />
              {right}
            </aside>
          ) : null}
        </div>
      </div>
      <ConsoleDialog
        open={palette}
        onClose={() => setPalette(false)}
        title="Перейти к разделу"
        description="Поиск открывает страницы. Команды управления здесь не выполняются."
      >
        <Command label="Поиск по консоли">
          <CommandInput
            autoFocus
            placeholder="Название раздела…"
            className={`${controlClass} mb-3 w-full`}
          />
          <CommandList className="max-h-80 overflow-y-auto">
            <CommandEmpty className="text-waia-fg-muted p-4 text-sm">Раздел не найден</CommandEmpty>
            {ADMIN_SECTIONS.map((item) => (
              <CommandItem
                key={item.href}
                value={item.title}
                onSelect={() => {
                  setPalette(false);
                  router.push(href(item.href));
                }}
                className="data-[selected=true]:bg-waia-elevated flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 text-sm"
              >
                <item.icon size={17} aria-hidden="true" />
                {item.title}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </ConsoleDialog>
      <EmergencyWorkflow
        open={emergency}
        onClose={() => setEmergency(false)}
        catalogue={catalogue}
      />
    </div>
  );
}
