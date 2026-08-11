import { HowBuiltDiagram } from "@/components/landing/visuals/how-built-diagram";
import { LandingPrimaryCta } from "@/components/landing/landing-primary-cta";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
  SectionStack,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { LEGCO_RESEARCH_URL, WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";

const copy = HOMEPAGE_COPY.howBuilt;

export function HowWaiaIsBuiltSection() {
  return (
    <HomepageSection testId="landing-how-built" ariaLabel="How WAIA Is Built">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start lg:gap-12 xl:gap-16">
        <SectionStack>
          <SectionHeading testId="landing-how-built-title">{copy.title}</SectionHeading>
          <p
            data-testid="landing-how-built-mantra"
            className="font-waia-serif max-w-[42rem] text-lg leading-snug text-[#e8dcc4] sm:text-xl"
          >
            {copy.mantra}
          </p>
          <SectionBody testId="landing-how-built-research">{copy.researchLed}</SectionBody>
          <SectionBody testId="landing-how-built-legco">{copy.legco}</SectionBody>
          <SectionBody testId="landing-how-built-github">{copy.github}</SectionBody>
          <SectionBody testId="landing-how-built-openness">{copy.openness}</SectionBody>
          <SectionNote testId="landing-how-built-invite">{copy.invite}</SectionNote>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <LandingPrimaryCta
              testId="landing-how-built-legco-cta"
              href={LEGCO_RESEARCH_URL}
              external
              className="w-full sm:w-auto"
            >
              {copy.researchCta}
            </LandingPrimaryCta>
            <LandingPrimaryCta
              testId="landing-how-built-github-cta"
              href={WAIA_PUBLIC_GITHUB_URL}
              external
              className="w-full sm:w-auto"
            >
              {copy.sourceCta}
            </LandingPrimaryCta>
          </div>
        </SectionStack>
        <HowBuiltDiagram />
      </div>
    </HomepageSection>
  );
}
