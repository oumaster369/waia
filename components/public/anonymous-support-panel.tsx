import type { PublishedSupportAddress } from "@/lib/landing/support-address";

import { publicPanelClass } from "./public-page-shell";

type AnonymousSupportPanelProps = {
  support: PublishedSupportAddress | null;
  testId: string;
};

/**
 * One canonical anonymous-support block shared by the public and authenticated
 * Breath of WAIA pages. Keeping the copy and address rendering here prevents
 * the two payment entry points from drifting apart.
 */
export function AnonymousSupportPanel({ support, testId }: AnonymousSupportPanelProps) {
  if (!support) {
    return (
      <section data-testid={testId} className={publicPanelClass}>
        <h2 className="font-waia-serif text-waia-fg text-xl">Payment address not yet published</h2>
        <p className="text-waia-fg-muted mt-3 max-w-2xl leading-relaxed">
          The support page is ready, but the governed WAIA USDT TRC-20 address has not been
          published. Do not send funds to an address received through another channel.
        </p>
      </section>
    );
  }

  return (
    <section data-testid={testId} className={`${publicPanelClass} space-y-5`}>
      <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.14em] uppercase">
        Anonymous support
      </p>
      <p className="text-waia-fg-subtle text-xs font-semibold tracking-[0.14em] uppercase">
        USDT · TRON (TRC-20)
      </p>
      <p
        data-testid={`${testId}-address`}
        className="text-waia-fg font-mono text-lg leading-relaxed break-all"
      >
        {support.address}
      </p>
      <p className="text-waia-fg-muted max-w-2xl text-sm leading-relaxed">
        For an anonymous contribution, send any amount of USDT on the TRON network directly to this
        address. It will be recorded under “Anonymous Patrons” after Human review; no wallet
        identity is published.
      </p>
      <a
        href={support.explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-waia-accent-warm inline-flex text-sm underline underline-offset-4"
      >
        Verify the official address in TronScan →
      </a>
    </section>
  );
}
