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

/**
 * Sync shell for tests and for `app/page` after session checks.
 *
 * Human visual-rhythm corrective:
 * - Hero → definition: normal flow, no negative margin
 * - definition → Auth: ~64 / 80 / 120px responsive
 * - Auth → Breath: ~80 / 96 / 128px responsive
 * - major narrative separation vs tighter bridge clusters
 */
export function LandingPageContent({ initialOauthErrorCode = null }: LandingPageContentProps = {}) {
  return (
    <main
      data-testid="landing"
      className="flex min-h-screen w-full flex-col bg-[#030813] pt-0 font-sans text-[rgba(210,205,195,0.9)]"
    >
      <div className="relative w-full">
        <HeroBlock />
        <div
          id={REGISTER_ANCHOR_ID}
          data-testid="landing-register-anchor"
          className="relative z-10 mx-auto mt-16 flex w-[calc(100%-32px)] max-w-[560px] scroll-mt-10 justify-center pb-20 sm:mt-20 sm:pb-24 lg:mt-[120px] lg:pb-32"
        >
          <AuthBlock className="w-full" initialOauthErrorCode={initialOauthErrorCode} />
        </div>
      </div>

      {/*
        Major narrative rhythm: 64 / 80 / 96 / 112px.
        Bridge clusters keep human/entrepreneur/interstitial moments closer
        to the sections they conceptually introduce.
      */}
      <div
        data-testid="landing-narrative-stack"
        className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pb-28 sm:gap-20 sm:px-8 lg:gap-24 xl:gap-28"
      >
        <BreathOfWaiaSection />

        <div
          data-testid="landing-cluster-human-twin"
          className="flex flex-col gap-10 sm:gap-12 lg:gap-14"
        >
          <HumanBridgeSection />
          <AiTwinSection />
        </div>

        <LivingLegacySection />

        <div
          data-testid="landing-cluster-breath-society"
          className="flex flex-col gap-10 sm:gap-12 lg:gap-14"
        >
          <BreathInterstitialCta />
          <SocietySection />
        </div>

        <div
          data-testid="landing-cluster-entrepreneur-3p"
          className="flex flex-col gap-10 sm:gap-12 lg:gap-14"
        >
          <EntrepreneurBridgeSection />
          <Business3PSection />
        </div>

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
