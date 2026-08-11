import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";
import { BREATH_ANCHOR_ID } from "@/lib/landing/homepage-links";

const copy = HOMEPAGE_COPY.breathInterstitial;

export function BreathInterstitialCta() {
  return (
    <aside
      data-testid="landing-breath-interstitial"
      aria-label="Breath of WAIA contextual call to action"
      className="flex flex-col items-start gap-4 rounded-2xl border border-[rgba(218,200,160,0.28)] bg-[rgba(201,169,110,0.08)] px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-9 lg:py-10"
    >
      <p
        data-testid="landing-breath-interstitial-prompt"
        className="max-w-2xl text-base leading-relaxed text-[rgba(210,205,195,0.95)]"
      >
        {copy.prompt}
      </p>
      <a
        data-testid="landing-breath-interstitial-cta"
        href={`#${BREATH_ANCHOR_ID}`}
        className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg border border-[rgba(218,200,160,0.4)] bg-[rgba(201,169,110,0.18)] px-4 text-sm font-medium text-[#e8dcc4] transition hover:bg-[rgba(201,169,110,0.28)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a96e]"
      >
        {copy.cta}
      </a>
    </aside>
  );
}
