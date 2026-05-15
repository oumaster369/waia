import { AuthBlock } from "@/components/landing/AuthBlock";
import { ClosingBlock } from "@/components/landing/ClosingBlock";
import { ContextBlock } from "@/components/landing/ContextBlock";
import { HeroComposition } from "@/components/landing/hero-composition";
import { LandingCeremonialShell } from "@/components/landing/landing-ceremonial-shell";
import { ModulesPreview } from "@/components/landing/ModulesPreview";

/** Sync shell for tests and for `app/page` after session checks. */
export function LandingPageContent() {
  return (
    <LandingCeremonialShell>
      <main
        data-testid="landing"
        className="relative z-0 mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-16 px-4 pb-16 sm:gap-20 sm:px-8"
      >
        <div className="flex flex-col items-center gap-16 pb-6 pt-10 sm:gap-[5rem] sm:pb-8 sm:pt-14">
          <HeroComposition />
          <AuthBlock />
        </div>
        <ContextBlock />
        <ModulesPreview />
        <ClosingBlock />
      </main>
    </LandingCeremonialShell>
  );
}
