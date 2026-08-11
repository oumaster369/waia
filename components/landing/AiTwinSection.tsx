import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import { NarrativeFinalImage } from "@/components/landing/visuals/narrative-final-image";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
  SectionStack,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.aiTwin;

export function AiTwinSection() {
  const readiness = getModuleReadiness("ai-twin");

  return (
    <HomepageSection testId="landing-ai-twin" ariaLabel="AI-TWIN">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start lg:gap-12 xl:gap-16">
        <SectionStack>
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
        </SectionStack>
        <NarrativeFinalImage
          testId="landing-ai-twin-media"
          asset="twin"
          className="mx-auto w-full max-w-md lg:mx-0 lg:max-w-none"
        />
      </div>
    </HomepageSection>
  );
}
