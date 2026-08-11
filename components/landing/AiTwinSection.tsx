import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import { FinalArtReadySlot } from "@/components/landing/visuals/final-art-ready-slot";
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
          <SectionBody testId="landing-ai-twin-purpose">{copy.purpose}</SectionBody>
          <p
            data-testid="landing-ai-twin-progression"
            className="rounded-xl border border-[rgba(218,200,160,0.16)] bg-[rgba(0,0,0,0.2)] px-4 py-3 font-mono text-sm text-[#ebe4d4]"
          >
            {copy.progression}
          </p>
          <SectionBody testId="landing-ai-twin-trajectory">{copy.trajectory}</SectionBody>
          <SectionNote testId="landing-ai-twin-boundary">{copy.boundary}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-ai-twin" />
        </div>
        <FinalArtReadySlot
          testId="landing-ai-twin-media"
          assetId="V-TWIN"
          motif="twin"
          purpose="AI-TWIN Human Co-Researcher visual — Mirror to Model to Observer to Co-Researcher"
        />
      </div>
    </HomepageSection>
  );
}
