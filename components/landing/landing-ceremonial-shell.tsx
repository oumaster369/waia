import type { ReactNode } from "react";

import { CeremonialAirDust } from "@/components/landing/ceremonial-air-dust";

/**
 * Partner-preview landing: oceanic midnight field, edge depth, vertical haze,
 * subliminal air. No competing page-center spotlight — chest-driven light lives in the hero.
 */
export function LandingCeremonialShell({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="waia-ceremony-root dark relative isolate min-h-screen w-full text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 [background-image:var(--waia-ceremony-edge-left),var(--waia-ceremony-edge-right)] bg-cover opacity-[0.92]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover opacity-[0.55] [background-image:var(--waia-ceremony-upper-well)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover opacity-[0.64] [background-image:var(--waia-ceremony-haze-vertical)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-cover opacity-[0.41] [background-image:var(--waia-ceremony-vignette)]"
      />
      <CeremonialAirDust />
      {children}
    </div>
  );
}
