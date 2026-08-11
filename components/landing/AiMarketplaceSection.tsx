import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.marketplace;

export function AiMarketplaceSection() {
  const readiness = getModuleReadiness("ai-marketplace");

  return (
    <HomepageSection testId="landing-ai-marketplace" ariaLabel="AI-Marketplace">
      <div className="flex flex-col gap-3">
        <SectionHeading testId="landing-ai-marketplace-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-ai-marketplace-body">{copy.body}</SectionBody>
        <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-ai-marketplace" />
      </div>
    </HomepageSection>
  );
}
