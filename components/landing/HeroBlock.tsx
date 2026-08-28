import { HOMEPAGE_COPY } from "@/lib/landing/homepage-copy";

const HERO_DESKTOP = "/brand/heap_comp_1.webp";
const HERO_MOBILE = "/brand/head_mobile_1.webp";

/**
 * Brand art (existing assets — no new artwork) + English “What is WAIA?” definition.
 * The definition lives inside the artwork's lower field so the framed hero reads
 * as one composition instead of an image followed by a detached caption.
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
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[40%] bg-[linear-gradient(180deg,transparent_0%,rgba(3,8,19,0.38)_42%,rgba(3,8,19,0.82)_100%)]"
        />
        <div
          data-testid="landing-hero-definition"
          className="absolute inset-x-0 bottom-[11%] z-10 mx-auto flex w-full flex-col items-center px-5 text-center sm:bottom-[7%] sm:px-10 lg:bottom-[8%]"
        >
          <p
            data-testid="landing-hero-definition-text"
            className="font-waia-serif max-w-4xl text-[clamp(0.78rem,2.15vw,1.65rem)] leading-snug font-medium text-balance text-[#f0e4ce] [text-shadow:0_2px_18px_rgba(0,0,0,0.92)] sm:leading-relaxed"
          >
            {copy.definition}
          </p>
        </div>
      </div>
    </section>
  );
}
