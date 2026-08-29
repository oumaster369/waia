import Link from "next/link";

import { AuthBlock } from "@/components/landing/AuthBlock";

type TraderLandingPageProps = {
  initialOauthErrorCode?: string | null;
};

const TRUST_ITEMS = [
  {
    title: "Observation before action",
    body: "AI-TRADER presents evidence, risk and system state without promising a result.",
  },
  {
    title: "Paper by default",
    body: "Live trading and real capital remain unavailable until every separate safety gate is satisfied.",
  },
  {
    title: "Your connection stays bounded",
    body: "Exchange access is configured only after sign-in and never requested on this public page.",
  },
] as const;

export function TraderLandingPage({
  initialOauthErrorCode = null,
}: TraderLandingPageProps) {
  return (
    <main
      data-testid="trader-landing"
      className="relative isolate min-h-screen overflow-hidden bg-waia-field font-sans text-waia-fg"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-[-18rem] -z-10 mx-auto h-[42rem] max-w-[70rem] rounded-full bg-[radial-gradient(circle,var(--waia-color-accent-warm-muted)_0%,var(--waia-color-accent-cool-muted)_42%,transparent_72%)] blur-3xl"
      />

      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-waia-rim pb-5">
          <Link
            href="https://waia.life/"
            className="font-waia-serif text-xl font-medium tracking-[0.12em] text-waia-fg focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waia-accent-warm"
          >
            WAIA
          </Link>
          <span className="text-xs font-semibold tracking-[0.22em] text-waia-fg-muted uppercase">
            AI-TRADER
          </span>
        </header>

        <section
          aria-labelledby="trader-landing-title"
          className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.8fr)] lg:gap-20 lg:py-20"
        >
          <div className="mx-auto flex max-w-2xl flex-col items-start lg:mx-0">
            <p className="mb-5 text-xs font-semibold tracking-[0.24em] text-waia-accent-warm uppercase">
              Evidence-led market intelligence
            </p>
            <h1
              id="trader-landing-title"
              className="font-waia-serif text-[clamp(3rem,8vw,6.5rem)] leading-[0.92] font-medium tracking-[-0.045em] text-waia-fg"
            >
              See clearly.
              <span className="mt-2 block text-waia-fg-muted">Act only when justified.</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-waia-fg-muted sm:text-lg sm:leading-8">
              AI-TRADER turns market evidence into bounded decisions, including the decision not to
              trade. It does not promise profit and it never treats uncertainty as permission.
            </p>
            <div
              data-testid="trader-landing-posture"
              className="mt-8 inline-flex items-center gap-3 rounded-full border border-waia-rim bg-waia-field-mid px-4 py-2 text-sm text-waia-fg-muted"
            >
              <span className="h-2 w-2 rounded-full bg-waia-accent-warm" aria-hidden="true" />
              Paper-first · live and capital gates remain closed by default
            </div>
          </div>

          <div data-testid="trader-landing-auth-hero" className="w-full">
            <AuthBlock
              context="trader"
              initialMode="signIn"
              initialOauthErrorCode={initialOauthErrorCode}
              className="max-w-none"
            />
            <p className="mt-4 text-center text-xs leading-5 text-waia-fg-muted">
              Can&apos;t sign in or no longer have access?{" "}
              <Link
                href="https://waia.life/support"
                className="underline decoration-waia-rim underline-offset-4 hover:text-waia-fg focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waia-accent-warm"
              >
                Contact support
              </Link>
              .
            </p>
          </div>
        </section>

        <section
          aria-label="AI-TRADER trust boundaries"
          className="grid gap-px overflow-hidden rounded-2xl border border-waia-rim bg-waia-rim sm:grid-cols-3"
        >
          {TRUST_ITEMS.map((item) => (
            <article key={item.title} className="bg-waia-field px-5 py-6 sm:px-6">
              <h2 className="text-sm font-semibold text-waia-fg">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-waia-fg-muted">{item.body}</p>
            </article>
          ))}
        </section>

        <footer className="flex flex-col gap-3 py-7 text-xs leading-5 text-waia-fg-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Privacy: credentials are submitted only to WAIA&apos;s existing authentication service.</p>
          <nav aria-label="Trader support links" className="flex items-center gap-5">
            <Link
              href="https://waia.life/support"
              className="underline decoration-waia-rim underline-offset-4 hover:text-waia-fg focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waia-accent-warm"
            >
              Support
            </Link>
            <Link
              href="https://waia.life/"
              className="underline decoration-waia-rim underline-offset-4 hover:text-waia-fg focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-waia-accent-warm"
            >
              About WAIA
            </Link>
          </nav>
        </footer>
      </div>
    </main>
  );
}
