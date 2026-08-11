import { HowBuiltDiagram } from "@/components/landing/visuals/how-built-diagram";
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
            <a
              data-testid="landing-how-built-legco-cta"
              href={LEGCO_RESEARCH_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[rgba(218,200,160,0.4)] bg-[rgba(201,169,110,0.16)] px-4 text-sm font-medium text-[#e8dcc4] transition hover:bg-[rgba(201,169,110,0.26)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
            >
              {copy.researchCta}
            </a>
            <a
              data-testid="landing-how-built-github-cta"
              href={WAIA_PUBLIC_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[rgba(218,200,160,0.22)] px-4 text-sm font-medium text-[rgba(210,205,195,0.95)] transition hover:border-[rgba(218,200,160,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
            >
              {copy.sourceCta}
            </a>
          </div>
        </SectionStack>
        <HowBuiltDiagram />
      </div>
    </HomepageSection>
  );
}
