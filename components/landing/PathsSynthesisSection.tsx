import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionStack,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const copy = HOMEPAGE_COPY.paths;

export function PathsSynthesisSection() {
  return (
    <HomepageSection testId="landing-paths" ariaLabel="Human and entrepreneur paths">
      <SectionStack>
        <SectionHeading testId="landing-paths-title">{copy.title}</SectionHeading>
        <div className="grid gap-4 md:grid-cols-2 md:gap-5">
          <div className="rounded-xl border border-[rgba(218,200,160,0.14)] px-4 py-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Human
            </p>
            <SectionBody testId="landing-paths-human">{copy.human}</SectionBody>
          </div>
          <div className="rounded-xl border border-[rgba(218,200,160,0.14)] px-4 py-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Entrepreneur
            </p>
            <SectionBody testId="landing-paths-entrepreneur">{copy.entrepreneur}</SectionBody>
          </div>
        </div>
        <SectionBody testId="landing-paths-synthesis">{copy.synthesis}</SectionBody>
      </SectionStack>
    </HomepageSection>
  );
}
