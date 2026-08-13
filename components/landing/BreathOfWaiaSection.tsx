import { BreathSupportCta } from "@/components/landing/BreathSupportCta";
import { LandingPrimaryCta } from "@/components/landing/landing-primary-cta";
import { BreathDiagram } from "@/components/landing/visuals/breath-diagram";
import { BreathFundingGauge } from "@/components/landing/visuals/breath-runway-pulse";
import { formatBreathAmount, getBreathPublicSnapshot } from "@/lib/landing/breath-public";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { BREATH_ANCHOR_ID } from "@/lib/landing/homepage-links";
import { cn } from "@/lib/utils";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
  SectionNote,
} from "@/components/landing/homepage-section";

const copy = HOMEPAGE_COPY.breath;

const RESOURCE_KEYS = ["entered", "allocated", "spent", "remaining", "neededNext"] as const;

const BUDGET_KEYS = ["planned", "funded", "committed", "spent", "remaining"] as const;

/** Quieter secondary transparency cells — subordinate to funding gauge / support. */
const secondaryCellClass =
  "rounded-lg border border-[rgba(150,190,200,0.1)] bg-[rgba(4,12,22,0.22)] px-3 py-2";

const pendingValueClass = "mt-1 font-mono text-sm text-[rgba(175,200,208,0.58)] tabular-nums";

const stageValueClass = "mt-1 text-sm text-[rgba(200,220,225,0.72)]";

/**
 * Breath of WAIA — living economic surface.
 * Atmosphere is homepage-local; financial truth remains ledger-owned (Finance boundary).
 */
export function BreathOfWaiaSection() {
  const snapshot = getBreathPublicSnapshot();
  const currency = snapshot.resources.currency;
  const isPending = snapshot.status === "pending";

  return (
    <HomepageSection
      id={BREATH_ANCHOR_ID}
      testId="landing-breath"
      ariaLabel="Breath of WAIA"
      className={[
        "border-[rgba(150,195,205,0.3)]",
        "bg-[linear-gradient(165deg,rgba(12,42,58,0.55)_0%,rgba(3,8,19,0.72)_42%,rgba(6,28,36,0.5)_100%)]",
        "shadow-[inset_0_1px_0_rgba(180,220,230,0.08),inset_0_-40px_80px_rgba(20,70,90,0.12)]",
      ].join(" ")}
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-start lg:gap-12 xl:gap-16">
        <div className="flex flex-col gap-5 sm:gap-6">
          <SectionHeading testId="landing-breath-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-breath-lead">{copy.lead}</SectionBody>

          {/* Compact metadata — no large treasury status card */}
          <dl
            data-testid="landing-breath-stage"
            data-publication-status={snapshot.status}
            className="grid gap-3 sm:grid-cols-2"
          >
            <div className={secondaryCellClass}>
              <dt className="text-xs text-[rgba(170,200,210,0.62)]">{copy.stageLabel}</dt>
              <dd data-testid="landing-breath-stage-value" className={stageValueClass}>
                {snapshot.stageLabel ?? copy.stagePending}
              </dd>
            </div>
            <div className={secondaryCellClass}>
              <dt className="text-xs text-[rgba(170,200,210,0.62)]">{copy.updatedLabel}</dt>
              <dd data-testid="landing-breath-updated-value" className={stageValueClass}>
                {snapshot.lastUpdatedAt ?? copy.updatedPending}
              </dd>
            </div>
          </dl>

          <BreathFundingGauge
            status={snapshot.status}
            idealAnnualBudget={snapshot.idealAnnualBudget}
            currentFreeFunds={snapshot.currentFreeFunds}
            runway={snapshot.runway}
          />

          <BreathSupportCta
            currentFreeFunds={snapshot.currentFreeFunds}
            idealAnnualBudget={snapshot.idealAnnualBudget}
          />

          <div
            data-testid="landing-breath-resources-block"
            className={isPending ? "opacity-80" : undefined}
          >
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-[rgba(180,210,218,0.72)] uppercase">
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
                  className={secondaryCellClass}
                >
                  <dt className="text-xs text-[rgba(170,200,210,0.58)]">
                    {copy.resourceLabels[key]}
                  </dt>
                  <dd className={pendingValueClass}>
                    {formatBreathAmount(snapshot.resources[key], currency)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div
            data-testid="landing-breath-budget-block"
            className={isPending ? "opacity-80" : undefined}
          >
            <h3 className="mb-3 text-xs font-semibold tracking-wide text-[rgba(180,210,218,0.72)] uppercase">
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
                  className={secondaryCellClass}
                >
                  <dt className="text-xs text-[rgba(170,200,210,0.58)]">
                    {copy.budgetLabels[key]}
                  </dt>
                  <dd className={pendingValueClass}>
                    {formatBreathAmount(snapshot.budget[key], snapshot.budget.currency)}
                  </dd>
                </div>
              ))}
            </dl>
            <div
              data-testid="landing-breath-budget-fill"
              data-has-ratio={snapshot.budget.fillRatio !== null ? "true" : "false"}
              className="mt-3 h-2 overflow-hidden rounded-full bg-[rgba(140,190,200,0.1)]"
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
            data-testid="landing-breath-activity"
            className={cn("flex flex-col gap-3", isPending && "opacity-80")}
          >
            <h3 className="text-xs font-semibold tracking-wide text-[rgba(180,210,218,0.72)] uppercase">
              {copy.activityTitle}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div data-testid="landing-breath-inflows">
                <p className="mb-2 text-xs text-[rgba(170,200,210,0.58)]">{copy.inflowsTitle}</p>
                {snapshot.recentActivity.inflows.length === 0 ? (
                  <p
                    data-testid="landing-breath-inflows-empty"
                    className="text-sm text-[rgba(175,200,208,0.55)]"
                  >
                    {copy.activityEmpty}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {snapshot.recentActivity.inflows.map((tx) => (
                      <li key={tx.id} className="text-sm text-[#e4eef0]">
                        {tx.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div data-testid="landing-breath-outflows">
                <p className="mb-2 text-xs text-[rgba(170,200,210,0.58)]">{copy.outflowsTitle}</p>
                {snapshot.recentActivity.outflows.length === 0 ? (
                  <p
                    data-testid="landing-breath-outflows-empty"
                    className="text-sm text-[rgba(175,200,208,0.55)]"
                  >
                    {copy.activityEmpty}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {snapshot.recentActivity.outflows.map((tx) => (
                      <li key={tx.id} className="text-sm text-[#e4eef0]">
                        {tx.label}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div data-testid="landing-breath-work" className="flex flex-col gap-3">
            <h3 className="text-xs font-semibold tracking-wide text-[rgba(180,210,218,0.85)] uppercase">
              Work transparency
            </h3>
            <SectionBody>
              {snapshot.work.summary ??
                "Inspect the public engineering record to see what project resources are producing."}
            </SectionBody>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <LandingPrimaryCta
                testId="landing-breath-github-primary"
                href={snapshot.work.githubUrl}
                external
                className="w-full sm:w-auto"
              >
                {copy.seeResourcesCta}
              </LandingPrimaryCta>
              <LandingPrimaryCta
                testId="landing-breath-github-secondary"
                href={snapshot.work.githubUrl}
                external
                className="w-full sm:w-auto"
              >
                {copy.viewSourceCta}
              </LandingPrimaryCta>
            </div>
          </div>

          <SectionNote testId="landing-breath-methodology">{snapshot.methodologyNote}</SectionNote>
        </div>

        <BreathDiagram />
      </div>
    </HomepageSection>
  );
}
