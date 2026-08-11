import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import { NarrativeMediaSlot } from "@/components/landing/NarrativeMediaSlot";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.society;

export function SocietySection() {
  const readiness = getModuleReadiness("society");

  return (
    <HomepageSection testId="landing-society" ariaLabel="Society">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-society-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-society-body">{copy.body}</SectionBody>
          <SectionNote testId="landing-society-present">{copy.present}</SectionNote>
          <SectionNote testId="landing-society-future">{copy.future}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-society" />
        </div>
        <NarrativeMediaSlot
          testId="landing-society-media"
          purpose="Society aligned life together visual"
        />
      </div>
    </HomepageSection>
  );
}
