import { AuthBlock } from "@/components/landing/AuthBlock";
import { AiMarketplaceSection } from "@/components/landing/AiMarketplaceSection";
import { AiTraderSection } from "@/components/landing/AiTraderSection";
import { AiTwinSection } from "@/components/landing/AiTwinSection";
import { BreathInterstitialCta } from "@/components/landing/BreathInterstitialCta";
import { BreathOfWaiaSection } from "@/components/landing/BreathOfWaiaSection";
import { Business3PSection } from "@/components/landing/Business3PSection";
import { EntrepreneurBridgeSection } from "@/components/landing/EntrepreneurBridgeSection";
import { EpistemicMethodSection } from "@/components/landing/EpistemicMethodSection";
import { FinalCtaSection } from "@/components/landing/FinalCtaSection";
import { HeroBlock } from "@/components/landing/HeroBlock";
import { HowWaiaIsBuiltSection } from "@/components/landing/HowWaiaIsBuiltSection";
import { HumanBridgeSection } from "@/components/landing/HumanBridgeSection";
import { LivingLegacySection } from "@/components/landing/LivingLegacySection";
import { PathsSynthesisSection } from "@/components/landing/PathsSynthesisSection";
import { SocietySection } from "@/components/landing/SocietySection";
import { WaiaCoreSection } from "@/components/landing/WaiaCoreSection";
import { WaiaDevOsSection } from "@/components/landing/WaiaDevOsSection";
import { REGISTER_ANCHOR_ID } from "@/lib/landing/homepage-links";

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
        <div
          id={REGISTER_ANCHOR_ID}
          className="relative z-10 -mt-[56px] mx-auto flex w-[calc(100%-32px)] max-w-[560px] scroll-mt-8 justify-center pb-10 sm:-mt-[72px] md:-mt-24 lg:-mt-[6rem]"
        >
          <AuthBlock className="w-full" initialOauthErrorCode={initialOauthErrorCode} />
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pb-24 pt-2 sm:gap-10 sm:px-8">
        <BreathOfWaiaSection />
        <HumanBridgeSection />
        <AiTwinSection />
        <LivingLegacySection />
        <BreathInterstitialCta />
        <SocietySection />
        <EntrepreneurBridgeSection />
        <Business3PSection />
        <AiTraderSection />
        <EpistemicMethodSection />
        <AiMarketplaceSection />
        <WaiaCoreSection />
        <HowWaiaIsBuiltSection />
        <WaiaDevOsSection />
        <PathsSynthesisSection />
        <FinalCtaSection />
      </div>
    </main>
  );
}
