import { AuthBlock } from "@/components/landing/AuthBlock";
import { ClosingBlock } from "@/components/landing/ClosingBlock";
import { ContextBlock } from "@/components/landing/ContextBlock";
import { HeroBlock } from "@/components/landing/HeroBlock";
import { ModulesPreview } from "@/components/landing/ModulesPreview";

/** Sync shell for tests and for `app/page` after session checks. */
export function LandingPageContent() {
  return (
    <main
      data-testid="landing"
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 px-4 pb-16 sm:px-8"
    >
      <HeroBlock />
      <AuthBlock />
      <ContextBlock />
      <ModulesPreview />
      <ClosingBlock />
    </main>
  );
}
