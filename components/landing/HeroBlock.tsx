const HERO_DESKTOP = "/brand/heap_comp_1.webp";
const HERO_MOBILE = "/brand/head_mobile_1.webp";

/**
 * Single prepared hero — responsive art via `<picture>`.
 * Wordmark and slogan live in the artwork only (no duplicate HTML copy).
 */
export function HeroBlock() {
  return (
    <section
      data-testid="landing-hero"
      aria-label="WAIA hero"
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
            alt="WAIA hero artwork including wordmark and tagline."
            className="mx-auto block h-auto w-full max-w-[1600px] object-contain object-bottom select-none"
            draggable={false}
          />
        </picture>
      </div>
    </section>
  );
}
