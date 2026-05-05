export function ClosingBlock() {
  return (
    <section
      data-testid="landing-closing"
      aria-label="WAIA closing"
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 py-12 text-center sm:py-16"
    >
      <p
        data-testid="landing-closing-anchor"
        className="text-2xl font-semibold tracking-tight sm:text-3xl"
      >
        Всё согласовано.
      </p>
      <p
        data-testid="landing-closing-narrative"
        className="text-balance text-base text-muted-foreground sm:text-lg"
      >
        Сначала ты согласован с собой, затем с другими, затем с системой. WAIA выстраивает эту
        последовательность.
      </p>
    </section>
  );
}
