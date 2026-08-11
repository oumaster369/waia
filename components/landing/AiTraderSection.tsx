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

const copy = HOMEPAGE_COPY.aiTrader;

export function AiTraderSection() {
  const readiness = getModuleReadiness("ai-trader");

  return (
    <HomepageSection testId="landing-ai-trader" ariaLabel="AI-TRADER">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-ai-trader-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-ai-trader-identity">{copy.identity}</SectionBody>
          <SectionBody testId="landing-ai-trader-waia-role">{copy.waiaRole}</SectionBody>
          <SectionBody testId="landing-ai-trader-user-role">{copy.userRole}</SectionBody>
          <SectionNote testId="landing-ai-trader-boundary">{copy.boundary}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-ai-trader" />
        </div>
        <NarrativeMediaSlot
          testId="landing-ai-trader-media"
          purpose="AI-TRADER knowledge-first market intelligence visual"
        />
      </div>
    </HomepageSection>
  );
}
