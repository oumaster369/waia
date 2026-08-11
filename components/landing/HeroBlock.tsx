import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const HERO_DESKTOP = "/brand/heap_comp_1.webp";
const HERO_MOBILE = "/brand/head_mobile_1.webp";

/**
 * Brand art (existing assets — no new artwork) + English “What is WAIA?” definition.
 */
export function HeroBlock() {
  const copy = HOMEPAGE_COPY.hero;

  return (
    <section
      data-testid="landing-hero"
      aria-label="WAIA — What is WAIA?"
      className="w-full bg-[#030813] pt-0 pb-0"
    >
      <div className="relative mx-auto w-full max-w-[1600px]">
        <picture data-testid="landing-hero-picture">
          <source
            data-testid="landing-hero-source-mobile"
            media="(max-width: 767px)"
            srcSet={HERO_MOBILE}
          />
          <img
            data-testid="landing-hero-image"
            src={HERO_DESKTOP}
            alt="WAIA brand artwork including wordmark and tagline."
            className="mx-auto block h-auto w-full max-w-[1600px] object-contain object-bottom select-none"
            draggable={false}
          />
        </picture>
      </div>

      <div
        data-testid="landing-hero-definition"
        className="mx-auto flex w-full max-w-3xl flex-col items-center gap-3 px-4 pb-2 pt-6 text-center sm:px-8 sm:pt-8"
      >
        <p
          data-testid="landing-hero-eyebrow"
          className="text-xs font-semibold tracking-[0.18em] text-[#c9a96e] uppercase"
        >
          {copy.eyebrow}
        </p>
        <h1
          data-testid="landing-hero-definition-text"
          className="font-waia-serif text-balance text-[clamp(1.35rem,3.2vw,1.85rem)] font-medium leading-snug text-[#e8dcc4]"
        >
          {copy.definition}
        </h1>
      </div>
    </section>
  );
}
