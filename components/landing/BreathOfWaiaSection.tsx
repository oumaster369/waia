import {
  formatBreathAmount,
  formatBreathRunway,
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

const RESOURCE_KEYS = ["entered", "allocated", "spent", "remaining", "neededNext"] as const;

const BUDGET_KEYS = ["planned", "funded", "committed", "spent", "remaining"] as const;

export function BreathOfWaiaSection() {
  const snapshot = getBreathPublicSnapshot();
  const currency = snapshot.resources.currency;

  return (
    <HomepageSection id={BREATH_ANCHOR_ID} testId="landing-breath" ariaLabel="Breath of WAIA">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start">
        <div className="flex flex-col gap-5">
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
                : `Published — ${snapshot.lastUpdatedAt}`}
            </p>
            <SectionNote testId="landing-breath-pending-hint">
              {snapshot.status === "pending" ? copy.pendingHint : snapshot.methodologyNote}
            </SectionNote>
          </div>

          <dl data-testid="landing-breath-stage" className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[rgba(218,200,160,0.12)] px-3 py-2">
              <dt className="text-xs text-[rgba(180,175,168,0.85)]">{copy.stageLabel}</dt>
              <dd data-testid="landing-breath-stage-value" className="mt-1 text-sm text-[#ebe4d4]">
                {snapshot.stageLabel ?? copy.stagePending}
              </dd>
            </div>
            <div className="rounded-lg border border-[rgba(218,200,160,0.12)] px-3 py-2">
              <dt className="text-xs text-[rgba(180,175,168,0.85)]">{copy.updatedLabel}</dt>
              <dd
                data-testid="landing-breath-updated-value"
                className="mt-1 text-sm text-[#ebe4d4]"
              >
                {snapshot.lastUpdatedAt ?? copy.updatedPending}
              </dd>
            </div>
          </dl>

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
                  <dd className="mt-1 font-mono text-sm text-[#ebe4d4] tabular-nums">
                    {formatBreathAmount(snapshot.resources[key], currency)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              {copy.budgetTitle}
            </h3>
            <dl
              data-testid="landing-breath-budget"
              className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            >
              {BUDGET_KEYS.map((key) => (
                <div
                  key={key}
                  data-testid={`landing-breath-budget-${key}`}
                  className="rounded-lg border border-[rgba(218,200,160,0.12)] px-3 py-2"
                >
                  <dt className="text-xs text-[rgba(180,175,168,0.85)]">
                    {copy.budgetLabels[key]}
                  </dt>
                  <dd className="mt-1 font-mono text-sm text-[#ebe4d4] tabular-nums">
                    {formatBreathAmount(snapshot.budget[key], snapshot.budget.currency)}
                  </dd>
                </div>
              ))}
            </dl>
            <div
              data-testid="landing-breath-budget-fill"
              data-has-ratio={snapshot.budget.fillRatio !== null ? "true" : "false"}
              className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,252,245,0.08)]"
              aria-label={
                snapshot.budget.fillRatio === null
                  ? "Budget fill pending publication"
                  : `Budget fill ${Math.round(snapshot.budget.fillRatio * 100)} percent`
              }
            >
              {snapshot.budget.fillRatio !== null ? (
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#c9a96e,#e8dcc4)]"
                  style={{
                    width: `${Math.max(0, Math.min(1, snapshot.budget.fillRatio)) * 100}%`,
                  }}
                />
              ) : null}
            </div>
          </div>

          <div
            data-testid="landing-breath-runway"
            className="rounded-lg border border-[rgba(218,200,160,0.12)] px-3 py-2"
          >
            <p className="text-xs text-[rgba(180,175,168,0.85)]">{copy.runwayLabel}</p>
            <p
              data-testid="landing-breath-runway-value"
              className="mt-1 font-mono text-sm text-[#ebe4d4] tabular-nums"
            >
              {formatBreathRunway(snapshot.runway)}
            </p>
          </div>

          <div data-testid="landing-breath-activity" className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-[#c9a96e] uppercase">
              {copy.activityTitle}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div data-testid="landing-breath-inflows">
                <p className="mb-2 text-xs text-[rgba(180,175,168,0.85)]">{copy.inflowsTitle}</p>
                {snapshot.recentActivity.inflows.length === 0 ? (
                  <p
                    data-testid="landing-breath-inflows-empty"
                    className="text-sm text-[rgba(180,175,168,0.8)]"
                  >
                    {copy.activityEmpty}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {snapshot.recentActivity.inflows.map((tx) => (
                      <li key={tx.id} className="text-sm text-[#ebe4d4]">
                        {tx.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div data-testid="landing-breath-outflows">
                <p className="mb-2 text-xs text-[rgba(180,175,168,0.85)]">{copy.outflowsTitle}</p>
                {snapshot.recentActivity.outflows.length === 0 ? (
                  <p
                    data-testid="landing-breath-outflows-empty"
                    className="text-sm text-[rgba(180,175,168,0.8)]"
                  >
                    {copy.activityEmpty}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {snapshot.recentActivity.outflows.map((tx) => (
                      <li key={tx.id} className="text-sm text-[#ebe4d4]">
                        {tx.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
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

          <SectionNote testId="landing-breath-methodology">{snapshot.methodologyNote}</SectionNote>
        </div>

        <NarrativeMediaSlot
          testId="landing-breath-media"
          purpose="Breath of WAIA resource and work transparency visual"
        />
      </div>
    </HomepageSection>
  );
}
