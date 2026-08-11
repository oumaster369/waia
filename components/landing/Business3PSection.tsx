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

const copy = HOMEPAGE_COPY.business3p;

export function Business3PSection() {
  const readiness = getModuleReadiness("business-3p");

  return (
    <HomepageSection testId="landing-business-3p" ariaLabel="3P Business">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-business-3p-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-business-3p-founder">{copy.founder}</SectionBody>
          <SectionBody testId="landing-business-3p-member">{copy.member}</SectionBody>
          <SectionNote testId="landing-business-3p-status">{copy.status}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-business-3p" />
        </div>
        <NarrativeMediaSlot
          testId="landing-business-3p-media"
          purpose="3P Provision Promotion Production visual"
        />
      </div>
    </HomepageSection>
  );
}
