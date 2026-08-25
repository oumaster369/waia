import Link from "next/link";

import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";
import { PublicRunwayValue } from "@/components/public/public-runway-value";
import { formatPublicDateTime, formatPublicMoney } from "@/lib/landing/public-format";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { BREATH_ANCHOR_ID } from "@/lib/landing/homepage-links";
import type { PublicTreasuryProjection } from "@/lib/waia-core/treasury/public/types";

const copy = HOMEPAGE_COPY.breath;

const quietLinkClass =
  "text-sm text-waia-fg-muted underline decoration-waia-divider underline-offset-4 transition-colors duration-waia-base hover:text-waia-accent-warm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-waia-accent-warm";

export function BreathOfWaiaSection({
  projection = null,
}: {
  projection?: PublicTreasuryProjection | null;
}) {
  const breath = projection?.breath;
  const publishedBreath =
    breath?.status === "published" &&
    breath.availableAmountMicros !== null &&
    breath.availableCurrency !== null &&
    breath.annualBudgetAmountMicros !== null &&
    breath.annualBudgetCurrency !== null &&
    breath.runway.status === "published"
      ? {
          availableAmountMicros: breath.availableAmountMicros,
          availableCurrency: breath.availableCurrency,
          annualBudgetAmountMicros: breath.annualBudgetAmountMicros,
          annualBudgetCurrency: breath.annualBudgetCurrency,
          runwayEndsAt: breath.runway.endsAt,
          lastUpdatedAt: breath.lastUpdatedAt,
        }
      : null;

  return (
    <HomepageSection
      id={BREATH_ANCHOR_ID}
      testId="landing-breath"
      ariaLabel="Breath of WAIA"
      className="border-waia-rim bg-waia-field-mid"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-7">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-breath-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-breath-lead">{copy.lead}</SectionBody>
        </div>

        {publishedBreath ? (
          <dl
            data-testid="landing-breath-facts"
            data-publication-status="published"
            className="border-waia-divider grid gap-7 border-y py-7 sm:grid-cols-3 sm:gap-5"
          >
            <div>
              <dt className="text-waia-fg-subtle text-xs font-semibold tracking-[0.12em] uppercase">
                {copy.availableLabel}
              </dt>
              <dd
                data-testid="landing-breath-available-value"
                className="text-waia-fg mt-2 font-mono text-2xl tabular-nums sm:text-3xl"
              >
                {formatPublicMoney(
                  publishedBreath.availableAmountMicros,
                  publishedBreath.availableCurrency,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-waia-fg-subtle text-xs font-semibold tracking-[0.12em] uppercase">
                {copy.runwayLabel}
              </dt>
              <dd className="text-waia-fg mt-2 font-mono text-2xl tabular-nums sm:text-3xl">
                <PublicRunwayValue endsAt={publishedBreath.runwayEndsAt} />
              </dd>
            </div>
            <div>
              <dt className="text-waia-fg-subtle text-xs font-semibold tracking-[0.12em] uppercase">
                {copy.annualBudgetLabel}
              </dt>
              <dd
                data-testid="landing-breath-annual-value"
                className="text-waia-fg mt-2 font-mono text-2xl tabular-nums sm:text-3xl"
              >
                {formatPublicMoney(
                  publishedBreath.annualBudgetAmountMicros,
                  publishedBreath.annualBudgetCurrency,
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <div
            data-testid="landing-breath-pending"
            data-publication-status="pending"
            className="border-waia-divider border-y py-7"
          >
            <p className="text-waia-fg-muted max-w-2xl text-base leading-relaxed">{copy.pending}</p>
          </div>
        )}

        {projection?.funds.status === "published" ? (
          <div
            data-testid="landing-breath-funds"
            className="border-waia-divider grid gap-5 border-b pb-7 sm:grid-cols-2"
          >
            <div>
              <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.12em] uppercase">
                WAIA operating fund
              </p>
              <p className="text-waia-fg mt-2 font-mono text-xl tabular-nums">
                {formatPublicMoney(
                  projection.funds.operatingAllocationMicros,
                  projection.funds.currency,
                )}
              </p>
            </div>
            <div>
              <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.12em] uppercase">
                Development Fund
              </p>
              <p className="text-waia-fg mt-2 font-mono text-xl tabular-nums">
                {formatPublicMoney(
                  projection.funds.developmentAllocationMicros,
                  projection.funds.currency,
                )}
              </p>
            </div>
            <p className="text-waia-fg-subtle text-xs leading-relaxed sm:col-span-2">
              This is a virtual accounting allocation. It does not move money or grant ownership,
              governance power, or spending authority.
            </p>
          </div>
        ) : null}

        {projection && projection.fundingNeeds.length > 0 ? (
          <div data-testid="landing-breath-funding-needs" className="flex flex-col gap-2">
            <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.12em] uppercase">
              Current funding needs
            </p>
            <ul className="text-waia-fg-muted flex flex-col gap-1 text-sm">
              {projection.fundingNeeds.map((need) => (
                <li key={`${need.title}:${need.currency}`}>
                  {need.title}: {formatPublicMoney(need.remainingAmountMicros, need.currency)}{" "}
                  remaining
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Link data-testid="landing-breath-budget-link" href="/budget" className={quietLinkClass}>
            {copy.budgetLink} →
          </Link>
          <Link
            data-testid="landing-breath-patrons-link"
            href="/patrons"
            className={quietLinkClass}
          >
            {copy.patronsLink} →
          </Link>
          <Link
            data-testid="landing-breath-work-plan-link"
            href="/work-plan"
            className={quietLinkClass}
          >
            {copy.workPlanLink} →
          </Link>
          {publishedBreath?.lastUpdatedAt ? (
            <p
              data-testid="landing-breath-updated"
              className="text-waia-fg-subtle text-xs sm:ml-auto"
            >
              Updated {formatPublicDateTime(publishedBreath.lastUpdatedAt)}
            </p>
          ) : null}
        </div>
      </div>
    </HomepageSection>
  );
}
