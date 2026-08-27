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
import type { PublicTreasuryProjection } from "@/lib/waia-core/treasury/public/types";

type LandingPageContentProps = {
  /** From server `searchParams` so OAuth redirect errors render without relying on client-only URL reads. */
  initialOauthErrorCode?: string | null;
  publicTreasury?: PublicTreasuryProjection | null;
};

/**
 * Sync shell for tests and for `app/page` after session checks.
 *
 * Approved homepage composition:
 * - framed Hero owns the definition in normal flow
 * - Auth and Breath are equal desktop columns immediately below it
 * - the same surfaces stack at equal full width on small screens
 * - major narrative separation vs tighter bridge clusters
 */
export function LandingPageContent({
  initialOauthErrorCode = null,
  publicTreasury = null,
}: LandingPageContentProps = {}) {
  return (
    <main
      data-testid="landing"
      className="flex min-h-screen w-full flex-col bg-[#030813] pt-0 font-sans text-[rgba(210,205,195,0.9)]"
    >
      <div className="relative w-full px-4 pt-4 sm:px-8 sm:pt-8">
        <HeroBlock />
        <div className="mx-auto mt-16 grid w-full max-w-6xl gap-6 pb-20 sm:mt-20 sm:pb-24 lg:mt-24 lg:grid-cols-2 lg:items-stretch lg:pb-28">
          <div
            id={REGISTER_ANCHOR_ID}
            data-testid="landing-register-anchor"
            className="relative z-10 flex min-w-0 scroll-mt-10"
          >
            <AuthBlock
              className="h-full w-full max-w-none"
              initialOauthErrorCode={initialOauthErrorCode}
            />
          </div>
          <BreathOfWaiaSection projection={publicTreasury} />
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
