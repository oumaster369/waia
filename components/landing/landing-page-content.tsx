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
      className="flex min-h-screen w-full flex-col bg-[#030813] pt-0 font-sans text-[rgba(210,205,195,0.9)]"
    >
      <div className="relative w-full">
        <HeroBlock />
        {/*
          Overlap sits on lower dark band of hero; margins tuned so wordmark/tagline in art stay clear (esp. mobile).
        */}
        <div className="relative z-10 -mt-[56px] mx-auto flex w-[calc(100%-32px)] max-w-[560px] justify-center pb-10 sm:-mt-[72px] md:-mt-24 lg:-mt-[6rem]">
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
