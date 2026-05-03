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
        Вы здесь, в пространстве WAIA.
      </p>
      <p
        data-testid="landing-context-description"
        className="text-balance text-base text-muted-foreground sm:text-lg"
      >
        WAIA — это модульная AI-экосистема: персональный AI-Twin, бизнес-слой, финансовый слой и
        маркетплейс. Сначала ты создаёшь свой AI-Twin, дальше открываются остальные слои.
      </p>
    </section>
  );
}
