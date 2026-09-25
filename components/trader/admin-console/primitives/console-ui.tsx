"use client";
import * as React from "react";
import { ArrowUpRight, Inbox, LoaderCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import type { AdminSection } from "@/components/trader/admin-console/navigation/sections";

export const controlClass =
  "h-9 rounded-lg border border-waia-rim bg-waia-field-mid px-3 text-sm text-waia-fg outline-none transition-colors hover:border-waia-accent-cool focus-visible:ring-2 focus-visible:ring-waia-accent-cool disabled:cursor-not-allowed disabled:opacity-50";
export function ConsolePanel({
  title,
  note,
  action,
  children,
  className,
}: {
  title?: string;
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-waia-divider bg-waia-field-mid rounded-xl border", className)}>
      {title ? (
        <header className="border-waia-divider flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-waia-fg text-sm font-semibold">{title}</h2>
            {note ? <p className="text-waia-fg-muted mt-1 text-xs leading-5">{note}</p> : null}
          </div>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}
export function ConsoleLoading({ label = "Читаем сохранённые данные…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="border-waia-divider text-waia-fg-muted flex items-center gap-3 rounded-xl border px-5 py-8 text-sm"
    >
      <LoaderCircle
        aria-hidden="true"
        size={17}
        className="animate-spin motion-reduce:animate-none"
      />
      {label}
    </div>
  );
}
export function ConsoleEmpty({
  title = "Записей пока нет",
  description = "В выбранном охвате нет сохранённых записей.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <Inbox aria-hidden="true" size={26} className="text-waia-fg-muted mb-3" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-waia-fg-muted mt-2 max-w-md text-sm leading-6">{description}</p>
    </div>
  );
}
export function SectionTabs({ section }: { section: AdminSection }) {
  const { params, update } = useAdminReadContext();
  const requested =
    section.id === "system" && params.get("tab") === "controls" ? "authority" : params.get("tab");
  const selected = section.tabs.some(([id]) => id === requested) ? requested! : section.tabs[0][0];
  return (
    <div
      role="tablist"
      aria-label={`Вкладки: ${section.title}`}
      className="border-waia-divider bg-waia-field-mid sticky top-0 z-10 mb-6 flex gap-1 overflow-x-auto border-b"
    >
      {section.tabs.map(([id, label], index) => (
        <button
          key={id}
          type="button"
          role="tab"
          tabIndex={selected === id ? 0 : -1}
          aria-selected={selected === id}
          onKeyDown={(event) => {
            const next =
              event.key === "ArrowRight"
                ? (index + 1) % section.tabs.length
                : event.key === "ArrowLeft"
                  ? (index + section.tabs.length - 1) % section.tabs.length
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? section.tabs.length - 1
                      : null;
            if (next === null) return;
            event.preventDefault();
            update({ tab: section.tabs[next][0] });
            (
              event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined
            )?.focus();
          }}
          className={cn(
            "focus-visible:ring-waia-accent-cool relative shrink-0 border-b-2 px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset",
            selected === id
              ? "border-waia-accent-cool text-waia-fg font-semibold"
              : "text-waia-fg-muted hover:text-waia-fg border-transparent",
          )}
          onClick={() => update({ tab: id })}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
export function ConsoleTable<T>({
  rows,
  columns,
  rowKey,
  caption,
}: {
  rows: readonly T[];
  columns: { title: string; render: (row: T) => React.ReactNode; align?: "right" }[];
  rowKey: (row: T) => string;
  caption: string;
}) {
  if (!rows.length) return <ConsoleEmpty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-waia-divider bg-waia-elevated/20 text-waia-fg-muted border-b text-[11px]">
          <tr>
            {columns.map((column) => (
              <th
                scope="col"
                key={column.title}
                className={cn(
                  "px-5 py-3 font-medium whitespace-nowrap",
                  column.align === "right" && "text-right",
                )}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-waia-divider divide-y">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="hover:bg-waia-elevated/20">
              {columns.map((column) => (
                <td
                  key={column.title}
                  className={cn(
                    "px-5 py-4 align-top",
                    column.align === "right" && "text-right tabular-nums",
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function ConsoleBadge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] leading-4 font-medium",
        tone === "good"
          ? "border-waia-success/25 bg-waia-success/10 text-waia-success"
          : tone === "warning"
            ? "border-waia-warning/25 bg-waia-warning/10 text-waia-warning"
            : tone === "danger"
              ? "border-waia-danger/30 bg-waia-danger/10 text-waia-danger"
              : "border-waia-rim bg-waia-elevated/40 text-waia-fg-muted",
      )}
    >
      {children}
    </span>
  );
}
export function ConsoleDialog({
  title,
  description,
  children,
  open,
  onClose,
  dismissible = true,
  wide = false,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  dismissible?: boolean;
  wide?: boolean;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) {
      node.showModal();
      // React mounts inputs before the native dialog becomes focusable.
      node.querySelector<HTMLElement>("[data-console-autofocus]")?.focus();
    }
    else if (!open && node.open) node.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && dismissible) onClose();
      }}
      className={cn(
        "dark border-waia-rim bg-waia-field-mid text-waia-fg m-auto max-h-[88dvh] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl border p-0 shadow-2xl backdrop:bg-black/65",
        wide ? "max-w-4xl" : "max-w-xl",
      )}
    >
      <header className="border-waia-divider bg-waia-field-mid sticky top-0 z-10 flex items-start justify-between gap-4 border-b px-6 py-5">
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="text-waia-fg-muted mt-2 text-sm leading-6">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          aria-label="Закрыть"
          disabled={!dismissible}
          onClick={onClose}
          className="text-waia-fg-muted hover:bg-waia-elevated focus-visible:outline-waia-accent-cool shrink-0 rounded-lg p-1.5 focus-visible:outline-2 disabled:opacity-40"
        >
          <X size={20} />
        </button>
      </header>
      <div className="p-6">{open ? children : null}</div>
    </dialog>
  );
}
export function DetailLink({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-waia-fg focus-visible:outline-waia-accent-cool inline-flex items-center gap-1.5 text-left font-medium underline-offset-4 hover:underline focus-visible:outline-2"
    >
      {children}
      <ArrowUpRight size={13} aria-hidden="true" className="text-waia-fg-muted" />
    </button>
  );
}
export function EvidenceTime({
  at,
  label = "По состоянию на",
}: {
  at?: string | null;
  label?: string;
}) {
  if (!at || !Number.isFinite(Date.parse(at)))
    return <span className="text-waia-fg-muted">Время не установлено</span>;
  return (
    <time dateTime={at} title={at} className="text-waia-fg-muted tabular-nums">
      {label}{" "}
      {new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(new Date(at))}{" "}
      МСК
    </time>
  );
}
