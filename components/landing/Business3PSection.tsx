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
          <SectionBody testId="landing-business-3p-lead">{copy.lead}</SectionBody>
          <div data-testid="landing-business-3p-pillars" className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-[rgba(218,200,160,0.14)] px-3 py-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
                {copy.provisionTitle}
              </p>
              <SectionBody testId="landing-business-3p-provision" className="text-sm sm:text-sm">
                {copy.provision}
              </SectionBody>
            </div>
            <div className="rounded-xl border border-[rgba(218,200,160,0.14)] px-3 py-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
                {copy.promotionTitle}
              </p>
              <SectionBody testId="landing-business-3p-promotion" className="text-sm sm:text-sm">
                {copy.promotion}
              </SectionBody>
            </div>
            <div className="rounded-xl border border-[rgba(218,200,160,0.14)] px-3 py-3">
              <p className="mb-1 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
                {copy.productionTitle}
              </p>
              <SectionBody testId="landing-business-3p-production" className="text-sm sm:text-sm">
                {copy.production}
              </SectionBody>
            </div>
          </div>
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
