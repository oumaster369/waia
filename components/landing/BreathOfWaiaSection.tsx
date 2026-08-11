import {
  formatBreathAmount,
  getBreathPublicSnapshot,
} from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { BREATH_ANCHOR_ID } from "@/lib/landing/homepage-links";
import { NarrativeMediaSlot } from "@/components/landing/NarrativeMediaSlot";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";

const copy = HOMEPAGE_COPY.breath;

const RESOURCE_KEYS = [
  "entered",
  "allocated",
  "spent",
  "remaining",
  "neededNext",
] as const;

export function BreathOfWaiaSection() {
  const snapshot = getBreathPublicSnapshot();

  return (
    <HomepageSection
      id={BREATH_ANCHOR_ID}
      testId="landing-breath"
      ariaLabel="Breath of WAIA"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
        <div className="flex flex-col gap-4">
          <SectionHeading testId="landing-breath-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-breath-lead">{copy.lead}</SectionBody>

          <div
            data-testid="landing-breath-status"
            data-status={snapshot.status}
            className="rounded-xl border border-[rgba(218,200,160,0.18)] bg-[rgba(0,0,0,0.22)] px-4 py-3"
          >
            <p className="text-sm font-medium text-[#e8dcc4]">
              {snapshot.status === "pending"
                ? copy.pendingStatus
                : `Updated ${snapshot.lastUpdatedAt}`}
            </p>
            <SectionNote testId="landing-breath-pending-hint">
              {snapshot.status === "pending" ? copy.pendingHint : snapshot.methodologyNote}
            </SectionNote>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Resource transparency
            </h3>
            <dl
              data-testid="landing-breath-resources"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {RESOURCE_KEYS.map((key) => (
                <div
                  key={key}
                  data-testid={`landing-breath-resource-${key}`}
                  className="rounded-lg border border-[rgba(218,200,160,0.12)] px-3 py-2"
                >
                  <dt className="text-xs text-[rgba(180,175,168,0.85)]">
                    {copy.resourceLabels[key]}
                  </dt>
                  <dd className="mt-1 font-mono text-sm tabular-nums text-[#ebe4d4]">
                    {formatBreathAmount(
                      snapshot.resources[key],
                      snapshot.resources.currency,
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div data-testid="landing-breath-work" className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              Work transparency
            </h3>
            <SectionBody>
              {snapshot.work.summary ??
                "Inspect the public engineering record to see what project resources are producing."}
            </SectionBody>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <a
                data-testid="landing-breath-github-primary"
                href={snapshot.work.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[rgba(218,200,160,0.35)] bg-[rgba(201,169,110,0.12)] px-4 text-sm font-medium text-[#e8dcc4] transition hover:bg-[rgba(201,169,110,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
              >
                {copy.seeResourcesCta}
              </a>
              <a
                data-testid="landing-breath-github-secondary"
                href={snapshot.work.githubUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[rgba(218,200,160,0.22)] px-4 text-sm font-medium text-[rgba(210,205,195,0.95)] transition hover:border-[rgba(218,200,160,0.4)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
              >
                {copy.viewSourceCta}
              </a>
            </div>
          </div>

          <SectionNote testId="landing-breath-methodology">
            {snapshot.methodologyNote}
          </SectionNote>
        </div>

        <NarrativeMediaSlot
          testId="landing-breath-media"
          purpose="Breath of WAIA resource and work transparency visual"
        />
      </div>
    </HomepageSection>
  );
}
