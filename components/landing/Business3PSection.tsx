import { ModuleReadinessBar } from "@/components/landing/ModuleReadiness";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { getModuleReadiness } from "@/lib/landing/module-readiness";

const copy = HOMEPAGE_COPY.business3p;

/**
 * 3P visual system = the three pillars themselves (no separate media plate).
 */
export function Business3PSection() {
  const readiness = getModuleReadiness("business-3p");

  return (
    <HomepageSection testId="landing-business-3p" ariaLabel="3P Business">
      <div className="flex flex-col gap-5">
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <SectionHeading testId="landing-business-3p-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-business-3p-lead">{copy.lead}</SectionBody>
        </div>

        <div
          data-testid="landing-business-3p-pillars"
          className="grid gap-4 sm:grid-cols-3 sm:gap-5"
          role="list"
        >
          {(
            [
              {
                key: "provision",
                title: copy.provisionTitle,
                body: copy.provision,
                testId: "landing-business-3p-provision",
                step: "01",
              },
              {
                key: "promotion",
                title: copy.promotionTitle,
                body: copy.promotion,
                testId: "landing-business-3p-promotion",
                step: "02",
              },
              {
                key: "production",
                title: copy.productionTitle,
                body: copy.production,
                testId: "landing-business-3p-production",
                step: "03",
              },
            ] as const
          ).map((pillar) => (
            <div
              key={pillar.key}
              role="listitem"
              data-testid={`landing-business-3p-pillar-${pillar.key}`}
              className="relative flex flex-col gap-3 rounded-2xl border border-[rgba(218,200,160,0.28)] bg-[linear-gradient(180deg,rgba(201,169,110,0.1),rgba(0,0,0,0.22))] px-4 py-5 sm:min-h-[11rem] sm:px-5"
            >
              <p className="font-mono text-[0.65rem] tracking-[0.14em] text-[rgba(201,169,110,0.7)]">
                {pillar.step}
              </p>
              <p className="text-sm font-semibold tracking-[0.12em] text-[#e8dcc4] uppercase">
                {pillar.title}
              </p>
              <SectionBody testId={pillar.testId} className="text-sm leading-relaxed sm:text-sm">
                {pillar.body}
              </SectionBody>
            </div>
          ))}
        </div>

        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          <SectionBody testId="landing-business-3p-founder">{copy.founder}</SectionBody>
          <SectionBody testId="landing-business-3p-member">{copy.member}</SectionBody>
          <SectionNote testId="landing-business-3p-status">{copy.status}</SectionNote>
          <ModuleReadinessBar readiness={readiness} testIdPrefix="landing-business-3p" />
        </div>
      </div>
    </HomepageSection>
  );
}
