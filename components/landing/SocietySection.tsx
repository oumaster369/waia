import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import { SocietyDiagram } from "@/components/landing/visuals/society-diagram";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.society;

/** Visual-left on desktop for page rhythm after Living Legacy (DEE-608 B1). */
export function SocietySection() {
  const readiness = getModuleReadiness("society");

  return (
    <HomepageSection testId="landing-society" ariaLabel="Society">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="order-2 flex flex-col gap-3 lg:order-1">
          <SocietyDiagram />
        </div>
        <div className="order-1 flex flex-col gap-3 lg:order-2">
          <SectionHeading testId="landing-society-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-society-body">{copy.body}</SectionBody>
          <SectionNote testId="landing-society-present">{copy.present}</SectionNote>
          <SectionNote testId="landing-society-future">{copy.future}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-society" />
        </div>
      </div>
    </HomepageSection>
  );
}
