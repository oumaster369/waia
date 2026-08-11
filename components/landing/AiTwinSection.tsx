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

const copy = HOMEPAGE_COPY.aiTwin;

export function AiTwinSection() {
  const readiness = getModuleReadiness("ai-twin");

  return (
    <HomepageSection testId="landing-ai-twin" ariaLabel="AI-TWIN">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-ai-twin-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-ai-twin-present">{copy.present}</SectionBody>
          <SectionBody testId="landing-ai-twin-trajectory">{copy.trajectory}</SectionBody>
          <SectionNote testId="landing-ai-twin-boundary">{copy.boundary}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-ai-twin" />
        </div>
        <NarrativeMediaSlot
          testId="landing-ai-twin-media"
          purpose="AI-TWIN Human Co-Researcher visual"
        />
      </div>
    </HomepageSection>
  );
}
