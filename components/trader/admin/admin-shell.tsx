"use client";

import { PulseShell } from "@/components/trader/admin/pulse-shell";

export function AdminShell({ children }: { children: React.ReactNode }) {
  return <PulseShell>{children}</PulseShell>;
}
