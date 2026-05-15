/**
 * WAIA landing emblem — geometry aligned to `composition.png`, mood to `web_waia.png`.
 * Single aspect-ratio frame; silhouettes converge on-axis; central witness + chest origin
 * read as one ritual mark (screen bloom reinforces the PNG dot without replacing it).
 */
export function HeroComposition() {
  return (
    <section
      data-testid="landing-hero"
      aria-label="WAIA hero"
      className="flex w-full flex-col items-center px-3 text-center sm:px-4"
    >
      <div className="relative mx-auto flex w-full max-w-[min(94vw,21rem)] flex-col items-center sm:max-w-[22rem]">
        {/* Unified emblem — all figure PNG geometry resolves here */}
        <div className="relative w-full overflow-visible pb-1 sm:pb-2">
          <div className="relative mx-auto aspect-[10/13] w-full max-h-[min(54vh,432px)] overflow-visible sm:max-h-[min(58vh,468px)]">
            {/* Field depth */}
            <div
              aria-hidden
              className="waia-hero-field-drift pointer-events-none absolute left-1/2 top-[27%] -z-10 h-[96%] w-[138%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] opacity-[0.38] blur-[48px] sm:blur-[56px]"
              style={{
                background:
                  "radial-gradient(ellipse 54% 50% at 50% 46%, oklch(0.42 0.072 82 / 0.048) 0%, transparent 76%), radial-gradient(ellipse 44% 44% at 58% 36%, oklch(0.34 0.038 265 / 0.042) 0%, transparent 72%)",
              }}
            />

            {/* Downward volumetric falloff from chest origin — lights the field toward auth; large blur, low chroma */}
            <div
              aria-hidden
              className="waia-emblem-chest-field pointer-events-none absolute bottom-[8.5%] left-1/2 z-[1] h-[min(142%,28rem)] w-[min(124%,21rem)] max-w-[24rem] -translate-x-1/2 translate-y-[22%] rounded-[50%] mix-blend-screen opacity-[0.42] blur-[56px] sm:bottom-[8%] sm:h-[min(138%,30rem)] sm:w-[min(120%,22rem)] sm:translate-y-[20%] sm:blur-[72px]"
              style={{
                background:
                  "radial-gradient(ellipse 58% 28% at 50% 0%, oklch(0.8 0.056 82 / 0.125) 0%, oklch(0.5 0.048 268 / 0.065) 44%, oklch(0.3 0.042 268 / 0.028) 68%, transparent 84%)",
              }}
            />

            {/* Witness + embedded origin; blooms pinned to asset chest so mobile/desktop stay aligned */}
            <div className="pointer-events-none absolute left-1/2 top-[28.75%] z-[2] flex h-[58%] w-[41%] max-w-[9rem] -translate-x-1/2 -translate-y-full flex-col items-center justify-end sm:top-[27.75%]">
              <div className="relative flex w-full flex-col items-center justify-end">
                <img
                  src="/brand/central.png"
                  alt=""
                  width={800}
                  height={640}
                  className="relative z-[1] max-h-full w-full origin-bottom scale-[0.87] select-none object-contain object-bottom opacity-[0.74] contrast-[1.02] sm:opacity-[0.78]"
                  draggable={false}
                  style={{
                    filter:
                      "blur(0.45px) drop-shadow(0 0 8px oklch(1 0 0 / 0.28)) drop-shadow(0 0 24px oklch(0.9 0.02 95 / 0.12))",
                  }}
                />
                {/* Soft volumetric bloom at convergence (reads through silhouettes; not a second graphic) */}
                <div
                  aria-hidden
                  className="waia-emblem-convergence-bloom pointer-events-none absolute bottom-[5%] left-1/2 z-[2] h-[min(26vw,6.25rem)] w-[min(34vw,8rem)] -translate-x-1/2 translate-y-[22%] rounded-[50%] mix-blend-screen sm:bottom-[4.5%] sm:h-[6.75rem] sm:w-[8.5rem]"
                  style={{
                    background:
                      "radial-gradient(ellipse 52% 48% at 50% 46%, oklch(0.97 0.01 95 / 0.26) 0%, oklch(0.84 0.048 82 / 0.11) 40%, transparent 70%)",
                    filter: "blur(20px)",
                  }}
                />
                {/* Bright core so the chest origin stays legible on small screens */}
                <div
                  aria-hidden
                  className="waia-emblem-origin-core pointer-events-none absolute bottom-[6.25%] left-1/2 z-[3] h-7 w-7 -translate-x-1/2 translate-y-[18%] rounded-full mix-blend-plus-lighter opacity-[0.9] sm:bottom-[5.75%] sm:h-8 sm:w-8"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 50%, oklch(0.98 0.006 95 / 0.42) 0%, oklch(0.92 0.02 82 / 0.12) 44%, transparent 64%)",
                    filter: "blur(0.4px)",
                  }}
                />
              </div>
            </div>

            {/* Warm silhouette — inward reach */}
            <img
              src="/brand/left.png"
              alt=""
              width={360}
              height={560}
              className="waia-silhouette-warm pointer-events-none absolute bottom-[3.25%] left-1/2 z-20 h-[89.5%] w-auto max-w-[54%] -translate-x-[calc(100%-0.13rem)] select-none object-contain object-bottom object-right opacity-[0.94] sm:bottom-[2.85%] sm:h-[90.5%] sm:-translate-x-[calc(100%-0.09rem)]"
              draggable={false}
            />
            {/* Cool silhouette */}
            <img
              src="/brand/right.png"
              alt=""
              width={360}
              height={560}
              className="waia-silhouette-cool pointer-events-none absolute bottom-[3.25%] left-1/2 z-20 h-[89.5%] w-auto max-w-[54%] translate-x-[0.13rem] select-none object-contain object-bottom object-left opacity-[0.94] sm:bottom-[2.85%] sm:h-[90.5%] sm:translate-x-[0.09rem]"
              draggable={false}
            />
          </div>
        </div>

        {/* Monumental wordmark — intentional vertical silence */}
        <div className="relative z-10 mt-12 flex w-full flex-col items-center sm:mt-16">
          <img
            data-testid="landing-hero-logo"
            src="/brand/name.png"
            alt="WAIA"
            width={280}
            height={80}
            className="h-[2.85rem] w-auto max-w-[92vw] select-none object-contain opacity-[0.97] sm:h-[3.35rem]"
            draggable={false}
          />

          <h1
            data-testid="landing-hero-tagline"
            className="mt-9 max-w-lg text-balance font-light tracking-[0.06em] text-[1.05rem] leading-snug text-foreground/78 sm:mt-11 sm:text-[1.15rem] sm:tracking-[0.07em]"
          >
            Between you and you
          </h1>
          <p
            data-testid="landing-hero-positioning"
            className="mt-10 max-w-[23rem] text-balance text-[0.8125rem] leading-[1.65] text-muted-foreground/78 sm:mt-12 sm:max-w-[26rem] sm:text-[0.875rem]"
          >
            Drift beside yourself, overstimulation, the blur between thought and feeling—stillness you can
            trust, clarity that begins inward, alignment that holds.
          </p>
        </div>
      </div>
    </section>
  );
}
