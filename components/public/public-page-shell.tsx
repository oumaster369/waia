import Link from "next/link";
import type { ReactNode } from "react";

export function PublicPageShell({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <main className="bg-waia-field text-waia-fg min-h-screen px-4 py-10 font-sans sm:px-8 sm:py-14">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header className="border-waia-divider flex flex-col gap-5 border-b pb-8">
          <Link
            href="/#breath-of-waia"
            className="text-waia-fg-muted duration-waia-base hover:text-waia-accent-warm focus-visible:outline-waia-accent-warm w-fit text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-4"
          >
            ← Breath of WAIA
          </Link>
          <div className="max-w-3xl">
            <p className="text-waia-accent-cool text-xs font-semibold tracking-[0.16em] uppercase">
              {eyebrow}
            </p>
            <h1 className="font-waia-serif text-waia-fg mt-3 text-[clamp(2rem,5vw,3.5rem)] leading-tight">
              {title}
            </h1>
            <p className="text-waia-fg-muted mt-4 max-w-2xl text-base leading-relaxed sm:text-lg">
              {intro}
            </p>
          </div>
        </header>
        {children}
      </div>
    </main>
  );
}

export const publicPanelClass =
  "rounded-waia-surface border border-waia-rim bg-waia-field-mid p-5 shadow-[inset_0_1px_0_var(--waia-color-rim)] sm:p-7";

export const publicTableWrapClass =
  "overflow-x-auto rounded-waia-surface border border-waia-divider";

export const publicTableClass = "w-full min-w-[42rem] border-collapse text-left text-sm";
