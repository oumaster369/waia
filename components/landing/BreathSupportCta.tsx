import { LandingPrimaryCta } from "@/components/landing/landing-primary-cta";
import type { BreathMoney } from "@/lib/landing/breath-public";
import { isBreathAnnualTargetMet } from "@/lib/landing/breath-public";
import { getBreathSupportChannel } from "@/lib/landing/breath-support";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

type BreathSupportCtaProps = {
  currentFreeFunds: BreathMoney;
  idealAnnualBudget: BreathMoney;
};

/**
 * KEEP WAIA BREATHING — warm Human-action CTA.
 * Clickable only when: (1) support channel exists AND (2) annual target not met.
 * No arbitrary pre-target percentage lockout or visual threshold.
 */
export function BreathSupportCta({ currentFreeFunds, idealAnnualBudget }: BreathSupportCtaProps) {
  const copy = HOMEPAGE_COPY.breath;
  const channel = getBreathSupportChannel();
  const channelAvailable = channel.status === "available" && Boolean(channel.href);
  const fullyFunded = isBreathAnnualTargetMet(currentFreeFunds, idealAnnualBudget);
  const clickable = channelAvailable && !fullyFunded;

  return (
    <div
      data-testid="landing-breath-support"
      data-support-status={
        fullyFunded ? "fully-funded" : channel.status === "available" ? "available" : "pending"
      }
      data-support-clickable={clickable ? "true" : "false"}
      className="flex flex-col gap-3"
    >
      {!fullyFunded ? (
        <p
          data-testid="landing-breath-support-explanation"
          className="max-w-[42rem] text-sm leading-relaxed text-[rgba(210,220,225,0.88)] sm:text-base"
        >
          {copy.supportExplanation}
        </p>
      ) : null}

      {fullyFunded ? (
        <>
          <LandingPrimaryCta
            testId="landing-breath-support-cta"
            disabled
            className="w-full sm:w-auto sm:min-w-[16rem]"
          >
            {copy.supportFullyFunded}
          </LandingPrimaryCta>
          <p
            data-testid="landing-breath-support-funded"
            className="text-sm leading-relaxed text-[rgba(185,205,212,0.78)]"
          >
            Current free funds meet the ideal annual budget.
          </p>
        </>
      ) : clickable ? (
        <LandingPrimaryCta
          testId="landing-breath-support-cta"
          href={channel.href!}
          external={/^https?:\/\//.test(channel.href!)}
          className="w-full sm:w-auto sm:min-w-[16rem]"
        >
          {copy.supportCta}
        </LandingPrimaryCta>
      ) : (
        <>
          <LandingPrimaryCta
            testId="landing-breath-support-cta"
            disabled
            className="w-full sm:w-auto sm:min-w-[16rem]"
          >
            {copy.supportCta}
          </LandingPrimaryCta>
          <p
            data-testid="landing-breath-support-pending"
            className="text-sm leading-relaxed text-[rgba(185,205,212,0.78)]"
          >
            {copy.supportPendingNote}
          </p>
        </>
      )}
    </div>
  );
}
