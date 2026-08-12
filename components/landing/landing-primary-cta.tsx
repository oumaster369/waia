/**
 * Homepage-local primary CTA visual contract.
 * Source of truth: AuthBlock submit (Create Twin / Sign in).
 * Do not import into dashboard / trader / admin surfaces.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Exact Auth primary submit visual family — gold gradient Human action. */
export const LANDING_PRIMARY_CTA_CLASS = cn(
  "inline-flex h-12 min-h-12 items-center justify-center rounded-xl border border-[rgba(200,170,95,0.5)] px-5 text-base font-semibold tracking-tight shadow-none",
  "bg-[linear-gradient(180deg,#dcc065_0%,#b8942e_98%)] text-[#0b1018]",
  "transition-[filter,opacity] hover:brightness-[1.06]",
  "focus-visible:border-[rgba(224,198,130,0.7)] focus-visible:ring-2 focus-visible:ring-[rgba(212,184,122,0.35)] focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:brightness-100",
);

type LandingPrimaryCtaBase = {
  children: ReactNode;
  testId: string;
  className?: string;
  /** Soften emphasis near annual target without changing clickability. */
  subdued?: boolean;
};

type LandingPrimaryCtaLinkProps = LandingPrimaryCtaBase & {
  href: string;
  disabled?: false;
  external?: boolean;
};

type LandingPrimaryCtaDisabledProps = LandingPrimaryCtaBase & {
  href?: undefined;
  disabled: true;
};

export type LandingPrimaryCtaProps = LandingPrimaryCtaLinkProps | LandingPrimaryCtaDisabledProps;

/**
 * Button-like landing CTA using the Auth primary gold language.
 * Disabled renders a real button — never a fake anchor.
 */
export function LandingPrimaryCta(props: LandingPrimaryCtaProps) {
  const visual = cn(LANDING_PRIMARY_CTA_CLASS, props.subdued && "opacity-80", props.className);

  if (props.disabled) {
    return (
      <button
        type="button"
        data-testid={props.testId}
        disabled
        aria-disabled="true"
        className={visual}
      >
        {props.children}
      </button>
    );
  }

  return (
    <a
      data-testid={props.testId}
      href={props.href}
      className={visual}
      {...(props.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {props.children}
    </a>
  );
}
