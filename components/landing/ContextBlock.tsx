export function ContextBlock() {
  return (
    <section
      data-testid="landing-context"
      aria-label="WAIA context"
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-[rgba(218,200,160,0.28)] bg-[rgba(3,8,19,0.52)] px-6 py-10 text-center font-sans shadow-[inset_0_1px_0_rgba(255,252,245,0.06)] backdrop-blur-[12px] sm:px-10 sm:py-14"
    >
      <p
        data-testid="landing-context-anchor"
        className="font-waia-serif text-[clamp(1.25rem,2.4vw,1.625rem)] font-normal leading-snug text-[#e8dcc4]"
      >
        {"You're in the WAIA space."}
      </p>
      <p
        data-testid="landing-context-description"
        className="text-balance text-base font-normal leading-relaxed text-[rgba(210,205,195,0.92)] sm:text-lg"
      >
        WAIA is a modular AI ecosystem: a personal AI-Twin, a business layer, finance, and a marketplace.
        You start by building your AI-Twin; the other layers unlock as you grow.
      </p>
    </section>
  );
}
