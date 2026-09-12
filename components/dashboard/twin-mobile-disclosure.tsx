"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Presentation only: children stay mounted, and desktop content is always visible. */
export function TwinMobileDisclosure({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const lastFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const desktop = window.matchMedia("(min-width: 48rem)");
    function rememberFocus(event: FocusEvent) {
      lastFocusRef.current =
        event.target instanceof HTMLElement && wrapperRef.current?.contains(event.target)
          ? event.target
          : null;
    }
    function preserveFocus() {
      // CSS may blur a newly hidden node before the media-query event is delivered.
      const focused = lastFocusRef.current;
      if (desktop.matches && focused === triggerRef.current) {
        panelRef.current?.focus();
      } else if (!desktop.matches && focused && panelRef.current?.contains(focused)) {
        setOpen(true);
        requestAnimationFrame(() => {
          if (focused.isConnected && document.activeElement === document.body) {
            focused.focus({ preventScroll: true });
          }
        });
      }
    }
    document.addEventListener("focusin", rememberFocus);
    desktop.addEventListener("change", preserveFocus);
    return () => {
      document.removeEventListener("focusin", rememberFocus);
      desktop.removeEventListener("change", preserveFocus);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={cn("min-w-0", className)}
      onKeyDown={(event) => {
        const trigger = triggerRef.current;
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          open &&
          trigger &&
          getComputedStyle(trigger).display !== "none"
        ) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.focus();
        }
      }}
    >
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="border-waia-rim bg-waia-field text-waia-fg-primary h-auto min-h-11 w-full justify-between gap-3 rounded-none border-b px-4 py-3 text-left text-base whitespace-normal md:hidden"
      >
        <span className="min-w-0 [overflow-wrap:anywhere]">{label}</span>
        <ChevronDown aria-hidden className={cn("size-4 shrink-0", open && "rotate-180")} />
      </Button>
      <div
        ref={panelRef}
        id={panelId}
        tabIndex={-1}
        className={cn("min-w-0 md:block max-md:[&>aside]:w-full", !open && "hidden")}
      >
        {children}
      </div>
    </div>
  );
}
