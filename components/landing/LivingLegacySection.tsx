import { NarrativeMediaSlot } from "@/components/landing/NarrativeMediaSlot";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const copy = HOMEPAGE_COPY.livingLegacy;

export function LivingLegacySection() {
  return (
    <HomepageSection testId="landing-living-legacy" ariaLabel="A Legacy That Lives">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
        <NarrativeMediaSlot
          testId="landing-living-legacy-media"
          purpose="Living Legacy visual"
          className="order-2 lg:order-1"
        />
        <div className="order-1 flex flex-col gap-3 lg:order-2">
          <SectionHeading testId="landing-living-legacy-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-living-legacy-body">{copy.body}</SectionBody>
          <SectionNote testId="landing-living-legacy-boundary">{copy.boundary}</SectionNote>
        </div>
      </div>
    </HomepageSection>
  );
}
