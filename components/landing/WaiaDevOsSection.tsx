import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.devOs;

export function WaiaDevOsSection() {
  const readiness = getModuleReadiness("waia-dev-os");

  return (
    <HomepageSection testId="landing-dev-os" ariaLabel="WAIA DEV OS">
      <div className="flex flex-col gap-3">
        <SectionHeading testId="landing-dev-os-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-dev-os-body">{copy.body}</SectionBody>
        <p
          data-testid="landing-dev-os-cycle"
          className="rounded-xl border border-[rgba(218,200,160,0.16)] bg-[rgba(0,0,0,0.2)] px-4 py-3 font-mono text-sm leading-relaxed text-[#ebe4d4]"
        >
          {copy.cycle}
        </p>
        <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-dev-os" />
      </div>
    </HomepageSection>
  );
}
