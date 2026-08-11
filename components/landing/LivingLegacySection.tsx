import { NarrativeFinalImage } from "@/components/landing/visuals/narrative-final-image";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
  SectionStack,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const copy = HOMEPAGE_COPY.livingLegacy;

export function LivingLegacySection() {
  return (
    <HomepageSection testId="landing-living-legacy" ariaLabel="A Legacy That Lives">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-12 xl:gap-16">
        <NarrativeFinalImage
          testId="landing-living-legacy-media"
          asset="legacy"
          className="order-2 mx-auto w-full max-w-md lg:order-1 lg:mx-0 lg:max-w-none"
        />
        <SectionStack className="order-1 lg:order-2">
          <SectionHeading testId="landing-living-legacy-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-living-legacy-body">{copy.body}</SectionBody>
          <SectionBody
            testId="landing-living-legacy-example"
            className="font-waia-serif text-[1.05rem] leading-snug text-[#e8dcc4] sm:text-lg"
          >
            {copy.example}
          </SectionBody>
          <SectionBody testId="landing-living-legacy-closing">{copy.closing}</SectionBody>
          <SectionNote testId="landing-living-legacy-boundary">{copy.boundary}</SectionNote>
        </SectionStack>
      </div>
    </HomepageSection>
  );
}
