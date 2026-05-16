import { AuthBlock } from "@/components/landing/AuthBlock";
import { ClosingBlock } from "@/components/landing/ClosingBlock";
import { ContextBlock } from "@/components/landing/ContextBlock";
import { HeroBlock } from "@/components/landing/HeroBlock";
import { ModulesPreview } from "@/components/landing/ModulesPreview";

type LandingPageContentProps = {
  /** From server `searchParams` so OAuth redirect errors render without relying on client-only URL reads. */
  initialOauthErrorCode?: string | null;
};

/** Sync shell for tests and for `app/page` after session checks. */
export function LandingPageContent({
  initialOauthErrorCode = null,
}: LandingPageContentProps = {}) {
  return (
    <main
      data-testid="landing"
      className="flex min-h-screen w-full flex-col bg-[#030813] pt-0 font-sans text-waia-fg-muted"
    >
      <div className="relative w-full">
        <HeroBlock />
        {/*
          Overlap: mobile uses extra -80px vs prior -mt-10 so the form sits higher in the wave band only;
          tablet/desktop unchanged.
        */}
        <div className="relative z-10 -mt-[120px] mx-auto flex w-full max-w-md justify-center px-4 pb-10 md:-mt-28 lg:-mt-[7.5rem]">
          <AuthBlock className="w-full" initialOauthErrorCode={initialOauthErrorCode} />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-24 pt-2 sm:px-8">
        <ContextBlock />
        <ModulesPreview />
        <ClosingBlock />
      </div>
    </main>
  );
}
