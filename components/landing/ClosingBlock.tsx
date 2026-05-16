export function ClosingBlock() {
  return (
    <section
      data-testid="landing-closing"
      aria-label="WAIA closing"
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-xl border border-waia-accent-warm-muted/15 bg-waia-field/35 px-6 py-12 text-center font-sans backdrop-blur-[var(--waia-blur-veil-sm)] sm:px-10 sm:py-16"
    >
      <p
        data-testid="landing-closing-anchor"
        className="font-waia-serif text-xl font-medium leading-snug text-waia-accent-warm-muted sm:text-2xl"
      >
        Stay aligned.
      </p>
      <p
        data-testid="landing-closing-narrative"
        className="text-balance text-base font-normal text-waia-fg-muted sm:text-lg"
      >
        First with yourself, then with others, then with the systems you rely on. WAIA is built for that
        sequence.
      </p>
    </section>
  );
}
