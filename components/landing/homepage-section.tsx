import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type HomepageSectionProps = {
  id?: string;
  testId: string;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
};

/** Homepage-local section chrome — does not touch shared design-system primitives. */
export function HomepageSection({
  id,
  testId,
  ariaLabel,
  children,
  className,
}: HomepageSectionProps) {
  return (
    <section
      id={id}
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn(
        "scroll-mt-8 rounded-2xl border border-[rgba(218,200,160,0.22)] bg-[rgba(3,8,19,0.55)] px-5 py-8 shadow-[inset_0_1px_0_rgba(255,252,245,0.05)] backdrop-blur-[12px] sm:px-8 sm:py-10",
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

export function SectionHeading({
  children,
  testId,
  as: Tag = "h2",
}: SectionHeadingProps) {
  return (
    <Tag
      data-testid={testId}
      className="font-waia-serif text-[clamp(1.35rem,2.6vw,1.85rem)] font-medium leading-snug tracking-tight text-[#e8dcc4]"
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
        "text-base font-normal leading-relaxed text-[rgba(210,205,195,0.92)] sm:text-[1.0625rem]",
        className,
      )}
    >
      {children}
    </p>
  );
}

export function SectionNote({
  children,
  testId,
}: {
  children: ReactNode;
  testId?: string;
}) {
  return (
    <p
      data-testid={testId}
      className="text-sm leading-relaxed text-[rgba(180,175,168,0.88)]"
    >
      {children}
    </p>
  );
}
