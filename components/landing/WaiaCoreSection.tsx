import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.waiaCore;

export function WaiaCoreSection() {
  const readiness = getModuleReadiness("waia-core");

  return (
    <HomepageSection testId="landing-waia-core" ariaLabel="WAIA Core">
      <div className="flex flex-col gap-3">
        <SectionHeading testId="landing-waia-core-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-waia-core-body">{copy.body}</SectionBody>
        <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-waia-core" />
      </div>
    </HomepageSection>
  );
}
