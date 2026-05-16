export function ClosingBlock() {
  return (
    <section
      data-testid="landing-closing"
      aria-label="WAIA closing"
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-[rgba(218,200,160,0.28)] bg-[rgba(3,8,19,0.52)] px-6 py-12 text-center font-sans shadow-[inset_0_1px_0_rgba(255,252,245,0.06)] backdrop-blur-[12px] sm:px-10 sm:py-16"
    >
      <p
        data-testid="landing-closing-anchor"
        className="font-waia-serif text-xl font-medium leading-snug text-[#e8dcc4] sm:text-2xl"
      >
        Stay aligned.
      </p>
      <p
        data-testid="landing-closing-narrative"
        className="text-balance text-base font-normal leading-relaxed text-[rgba(210,205,195,0.92)] sm:text-lg"
      >
        First with yourself, then with others, then with the systems you rely on. WAIA is built for that
        sequence.
      </p>
    </section>
  );
}
