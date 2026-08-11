import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const copy = HOMEPAGE_COPY.epistemic;

const METHOD_STEPS = ["Observation", "Hypothesis", "Test", "Result", "Model Update"] as const;

/**
 * Intentional visual silence — typographic method sequence only (no illustration).
 */
export function EpistemicMethodSection() {
  return (
    <HomepageSection testId="landing-epistemic" ariaLabel="One epistemic method">
      <div className="flex flex-col gap-4">
        <SectionHeading testId="landing-epistemic-title">{copy.title}</SectionHeading>
        <SectionBody testId="landing-epistemic-lead">{copy.lead}</SectionBody>

        <ol
          data-testid="landing-epistemic-method-steps"
          className="flex list-none flex-wrap items-center gap-x-2 gap-y-2"
          aria-label="Epistemic method sequence"
        >
          {METHOD_STEPS.map((step, index) => (
            <li key={step} className="flex items-center gap-2">
              <span className="rounded-md border border-[rgba(218,200,160,0.22)] bg-[rgba(0,0,0,0.22)] px-2.5 py-1 text-xs font-medium tracking-wide text-[#e8dcc4] sm:text-sm">
                {step}
              </span>
              {index < METHOD_STEPS.length - 1 ? (
                <span aria-hidden className="text-[rgba(201,169,110,0.65)]">
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>

        <ol data-testid="landing-epistemic-domains" className="grid list-none gap-3 sm:grid-cols-3">
          <li className="rounded-xl border border-[rgba(218,200,160,0.14)] px-4 py-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Human
            </p>
            <SectionBody testId="landing-epistemic-human" className="text-sm sm:text-sm">
              {copy.human}
            </SectionBody>
          </li>
          <li className="rounded-xl border border-[rgba(218,200,160,0.14)] px-4 py-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Market
            </p>
            <SectionBody testId="landing-epistemic-market" className="text-sm sm:text-sm">
              {copy.market}
            </SectionBody>
          </li>
          <li className="rounded-xl border border-[rgba(218,200,160,0.14)] px-4 py-3">
            <p className="mb-1 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Society
            </p>
            <SectionBody testId="landing-epistemic-society" className="text-sm sm:text-sm">
              {copy.society}
            </SectionBody>
          </li>
        </ol>
        <SectionNote testId="landing-epistemic-boundary">{copy.boundary}</SectionNote>
      </div>
    </HomepageSection>
  );
}
