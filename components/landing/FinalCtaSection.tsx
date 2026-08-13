import { LandingPrimaryCta } from "@/components/landing/landing-primary-cta";
import { HomepageSection, SectionHeading } from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import {
  BREATH_ANCHOR_ID,
  LEGCO_RESEARCH_URL,
  REGISTER_ANCHOR_ID,
  WAIA_PUBLIC_GITHUB_URL,
} from "@/lib/landing/homepage-links";

const copy = HOMEPAGE_COPY.finalCta;

export function FinalCtaSection() {
  return (
    <HomepageSection
      testId="landing-final-cta"
      ariaLabel="Register and Breath of WAIA"
      className="border-[rgba(218,200,160,0.32)] bg-[rgba(201,169,110,0.07)]"
    >
      <div className="flex flex-col items-center gap-6 text-center sm:gap-7">
        <SectionHeading testId="landing-final-cta-title">{copy.title}</SectionHeading>
        <div className="flex w-full max-w-lg flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4">
          <LandingPrimaryCta
            testId="landing-final-cta-register"
            href={`#${REGISTER_ANCHOR_ID}`}
            className="w-full flex-1"
          >
            {copy.register}
          </LandingPrimaryCta>
          <LandingPrimaryCta
            testId="landing-final-cta-breath"
            href={`#${BREATH_ANCHOR_ID}`}
            className="w-full flex-1"
          >
            {copy.breath}
          </LandingPrimaryCta>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          <a
            data-testid="landing-final-cta-research"
            href={LEGCO_RESEARCH_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[rgba(210,205,195,0.88)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
          >
            {copy.research}
          </a>
          <a
            data-testid="landing-final-cta-github"
            href={WAIA_PUBLIC_GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-[rgba(210,205,195,0.88)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
          >
            {copy.source}
          </a>
        </div>
      </div>
    </HomepageSection>
  );
}
