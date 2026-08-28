import Link from "next/link";

import { BreathSupportCta } from "@/components/landing/BreathSupportCta";
import {
  HomepageSection,
  SectionBody,
  SectionHeading,
} from "@/components/landing/homepage-section";
import { BreathFundingGauge } from "@/components/landing/visuals/breath-runway-pulse";
import { BreathTimeRadar } from "@/components/landing/visuals/breath-time-radar";
import type { BreathMoney } from "@/lib/landing/breath-public";
import { formatPublicDateTime } from "@/lib/landing/public-format";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { BREATH_ANCHOR_ID, WAIA_PUBLIC_GITHUB_URL } from "@/lib/landing/homepage-links";
import type { PublicTreasuryProjection } from "@/lib/waia-core/treasury/public/types";

const copy = HOMEPAGE_COPY.breath;

const quietLinkClass =
  "text-sm text-waia-fg-muted underline decoration-waia-divider underline-offset-4 transition-colors duration-waia-base hover:text-waia-accent-warm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-waia-accent-warm";

function publicMoney(amountMicros: string | null, currency: string | null): BreathMoney {
  if (amountMicros === null || currency === null) {
    return { amount: null, currency: null };
  }

  try {
    return {
      amount: Number(BigInt(amountMicros)) / 1_000_000,
      currency,
    };
  } catch {
    return { amount: null, currency: null };
  }
}

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
          runwayHourlyBurnMicros: breath.runway.hourlyBurnMicros,
          runwayCurrency: breath.runway.currency,
          lastUpdatedAt: breath.lastUpdatedAt,
        }
      : null;

  return (
    <HomepageSection
      id={BREATH_ANCHOR_ID}
      testId="landing-breath"
      ariaLabel="Breath of WAIA"
      className="border-[rgba(150,195,205,0.3)] bg-[linear-gradient(165deg,rgba(12,42,58,0.55)_0%,rgba(3,8,19,0.72)_42%,rgba(6,28,36,0.5)_100%)] shadow-[inset_0_1px_0_rgba(180,220,230,0.08),inset_0_-40px_80px_rgba(20,70,90,0.12)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-7">
        <div className="flex flex-col gap-3">
          <SectionHeading testId="landing-breath-title">{copy.title}</SectionHeading>
          <SectionBody testId="landing-breath-lead">{copy.lead}</SectionBody>
        </div>

        <BreathFundingGauge
          status={publishedBreath ? "published" : "pending"}
          idealAnnualBudget={publicMoney(
            publishedBreath?.annualBudgetAmountMicros ?? null,
            publishedBreath?.annualBudgetCurrency ?? null,
          )}
          currentFreeFunds={publicMoney(
            publishedBreath?.availableAmountMicros ?? null,
            publishedBreath?.availableCurrency ?? null,
          )}
          runway={{
            periodLabel: null,
            value: null,
            unit: null,
            endsAt: publishedBreath?.runwayEndsAt ?? null,
          }}
          hourlyBurnMicros={publishedBreath?.runwayHourlyBurnMicros ?? null}
          runwayCurrency={publishedBreath?.runwayCurrency ?? null}
        />

        <BreathSupportCta
          currentFreeFunds={publicMoney(
            publishedBreath?.availableAmountMicros ?? null,
            publishedBreath?.availableCurrency ?? null,
          )}
          idealAnnualBudget={publicMoney(
            publishedBreath?.annualBudgetAmountMicros ?? null,
            publishedBreath?.annualBudgetCurrency ?? null,
          )}
        />

        <div className="grid gap-8 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-stretch">
          <nav
            aria-label="Breath of WAIA public records"
            className="flex flex-col items-start gap-3"
          >
            <Link
              data-testid="landing-breath-budget-link"
              href="/budget"
              className={quietLinkClass}
            >
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
            <a
              data-testid="landing-breath-github-link"
              href={WAIA_PUBLIC_GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={quietLinkClass}
            >
              Open-source code on GitHub →
            </a>
            <Link
              data-testid="landing-breath-foundation-link"
              href="/foundation"
              className={quietLinkClass}
            >
              Foundation →
            </Link>
            {publishedBreath?.lastUpdatedAt ? (
              <p data-testid="landing-breath-updated" className="text-waia-fg-subtle pt-2 text-xs">
                Updated {formatPublicDateTime(publishedBreath.lastUpdatedAt)}
              </p>
            ) : null}
          </nav>
          <BreathTimeRadar />
        </div>
      </div>
    </HomepageSection>
  );
}
