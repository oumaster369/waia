import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type HomepageSectionDensity = "narrative" | "bridge";

type HomepageSectionProps = {
  id?: string;
  testId: string;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  /**
   * Homepage-local vertical density.
   * - narrative: major story cards (default)
   * - bridge: short transitional moments
   */
  density?: HomepageSectionDensity;
};

/** Homepage-local section chrome — does not touch shared design-system primitives. */
export function HomepageSection({
  id,
  testId,
  ariaLabel,
  children,
  className,
  density = "narrative",
}: HomepageSectionProps) {
  return (
    <section
      id={id}
      data-testid={testId}
      data-section-density={density}
      aria-label={ariaLabel}
      className={cn(
        "scroll-mt-10 rounded-2xl border border-[rgba(218,200,160,0.22)] bg-[rgba(3,8,19,0.55)] px-5 shadow-[inset_0_1px_0_rgba(255,252,245,0.05)] backdrop-blur-[12px] sm:px-8",
        density === "narrative" ? "py-10 sm:py-12 lg:py-14 xl:py-16" : "py-8 sm:py-9 lg:py-10",
        className,
      )}
    >
      {children}
    </section>
  );
}

type SectionHeadingProps = {
  children: ReactNode;
  testId?: string;
  as?: "h2" | "h3";
};

export function SectionHeading({ children, testId, as: Tag = "h2" }: SectionHeadingProps) {
  return (
    <Tag
      data-testid={testId}
      className="font-waia-serif text-[clamp(1.35rem,2.6vw,1.85rem)] leading-snug font-medium tracking-tight text-[#e8dcc4]"
    >
      {children}
    </Tag>
  );
}

export function SectionBody({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className={cn(
        "max-w-[42rem] text-base leading-relaxed font-normal text-[rgba(210,205,195,0.92)] sm:text-[1.0625rem]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      data-testid={testId}
      className="max-w-[42rem] text-sm leading-relaxed text-[rgba(180,175,168,0.88)]"
    >
      {children}
    </p>
  );
}

/** Semantic text stack for content-heavy narrative columns. */
export function SectionStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col gap-4 sm:gap-5", className)}>{children}</div>;
}
