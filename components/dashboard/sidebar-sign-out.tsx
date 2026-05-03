"use client";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SidebarSignOut() {
  return (
    <button
      type="button"
      data-testid="dashboard-sidebar-sign-out"
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex w-full justify-center")}
      onClick={async () => {
        try {
          await fetch("/api/auth/sign-out", { method: "POST", credentials: "include" });
        } finally {
          window.location.href = "/";
        }
      }}
    >
      Sign out
    </button>
  );
}
