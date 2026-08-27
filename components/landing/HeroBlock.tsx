import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const HERO_DESKTOP = "/brand/heap_comp_1.webp";
const HERO_MOBILE = "/brand/head_mobile_1.webp";

/**
 * Brand art (existing assets — no new artwork) + English “What is WAIA?” definition.
 *
 * Human visual-rhythm corrective: normal document flow only.
 * No negative margin under the hero image — ~40–48px clear air on large displays.
 */
export function HeroBlock() {
  const copy = HOMEPAGE_COPY.hero;

  return (
    <section
      data-testid="landing-hero"
      aria-label="WAIA — What is WAIA?"
      className="mx-auto w-full max-w-[1600px] overflow-hidden rounded-[1.6rem] border border-[rgba(201,169,110,0.26)] bg-[#030813] shadow-[0_30px_100px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.04)]"
    >
      <div className="relative mx-auto w-full">
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
        className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 pt-8 pb-9 text-center sm:px-10 sm:pt-10 sm:pb-11"
      >
        <p
          data-testid="landing-hero-definition-text"
          className="font-waia-serif text-[clamp(1.35rem,3.2vw,1.85rem)] leading-snug font-medium text-balance text-[#e8dcc4]"
        >
          {copy.definition}
        </p>
      </div>
    </section>
  );
}
