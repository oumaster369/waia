import { getBreathSupportChannel } from "@/lib/landing/breath-support";
import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { cn } from "@/lib/utils";

/**
 * KEEP WAIA BREATHING — warm Human-action CTA.
 * Wired only when a canonical Finance support destination exists.
 */
export function BreathSupportCta() {
  const copy = HOMEPAGE_COPY.breath;
  const channel = getBreathSupportChannel();
  const available = channel.status === "available" && Boolean(channel.href);

  return (
    <div
      data-testid="landing-breath-support"
      data-support-status={channel.status}
      className="flex flex-col gap-3"
    >
      <p
        data-testid="landing-breath-support-explanation"
        className="max-w-[42rem] text-sm leading-relaxed text-[rgba(210,220,225,0.88)] sm:text-base"
      >
        {copy.supportExplanation}
      </p>

      {available ? (
        <a
          data-testid="landing-breath-support-cta"
          href={channel.href!}
          className={cn(
            "inline-flex min-h-12 w-full items-center justify-center rounded-lg px-5 text-sm font-semibold tracking-[0.04em] sm:w-auto sm:min-w-[16rem]",
            "border border-[rgba(218,200,160,0.55)] bg-[rgba(201,169,110,0.32)] text-[#1a1408]",
            "transition hover:bg-[rgba(201,169,110,0.42)]",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]",
          )}
        >
          {copy.supportCta}
        </a>
      ) : (
        <>
          <button
            type="button"
            data-testid="landing-breath-support-cta"
            disabled
            aria-disabled="true"
            className={cn(
              "inline-flex min-h-12 w-full cursor-not-allowed items-center justify-center rounded-lg px-5 text-sm font-semibold tracking-[0.04em] sm:w-auto sm:min-w-[16rem]",
              "border border-[rgba(218,200,160,0.4)] bg-[rgba(201,169,110,0.2)] text-[rgba(26,20,8,0.72)]",
              "opacity-90",
            )}
          >
            {copy.supportCta}
          </button>
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
