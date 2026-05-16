export function ContextBlock() {
  return (
    <section
      data-testid="landing-context"
      aria-label="WAIA context"
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-xl border border-waia-accent-warm-muted/15 bg-waia-field/35 px-6 py-10 text-center font-sans backdrop-blur-[var(--waia-blur-veil-sm)] sm:px-10 sm:py-14"
    >
      <p
        data-testid="landing-context-anchor"
        className="font-waia-serif text-[clamp(1.25rem,2.4vw,1.625rem)] font-normal leading-snug text-waia-accent-cool-muted"
      >
        {"You're in the WAIA space."}
      </p>
      <p
        data-testid="landing-context-description"
        className="text-balance text-base font-normal text-waia-fg-muted sm:text-lg"
      >
        WAIA is a modular AI ecosystem: a personal AI-Twin, a business layer, finance, and a marketplace.
        You start by building your AI-Twin; the other layers unlock as you grow.
      </p>
    </section>
  );
}
