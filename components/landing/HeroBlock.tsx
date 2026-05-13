export function HeroBlock() {
  return (
    <section
      data-testid="landing-hero"
      aria-label="WAIA hero"
      className="flex flex-col items-center gap-4 py-12 text-center sm:py-20"
    >
      <div
        data-testid="landing-hero-logo"
        aria-label="WAIA"
        className="text-3xl font-semibold tracking-tight sm:text-4xl"
      >
        WAIA
      </div>
      <h1
        data-testid="landing-hero-tagline"
        className="text-balance text-4xl font-semibold tracking-tight sm:text-6xl"
      >
        Between you. And you.
      </h1>
      <p
        data-testid="landing-hero-positioning"
        className="max-w-2xl text-balance text-base text-muted-foreground sm:text-lg"
      >
        WAIA helps you reconnect with yourself so you stay aligned—with people, work, and the world around you.
      </p>
    </section>
  );
}
