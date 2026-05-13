export function ContextBlock() {
  return (
    <section
      data-testid="landing-context"
      aria-label="WAIA context"
      className="mx-auto flex max-w-3xl flex-col items-center gap-3 py-10 text-center sm:py-14"
    >
      <p
        data-testid="landing-context-anchor"
        className="text-xl font-medium tracking-tight sm:text-2xl"
      >
        {"You're in the WAIA space."}
      </p>
      <p
        data-testid="landing-context-description"
        className="text-balance text-base text-muted-foreground sm:text-lg"
      >
        WAIA is a modular AI ecosystem: a personal AI-Twin, a business layer, finance, and a marketplace.
        You start by building your AI-Twin; the other layers unlock as you grow.
      </p>
    </section>
  );
}
