/** DEE-922 verbatim English baseline; reusable by the DEE-879 Formation migration. */
export const TWIN_SUBSCRIPTION_DISCLOSURE =
  "Creating and training your AI Twin is currently free. A monthly subscription will begin only after your Twin is fully formed and you choose to connect it to the future social network of AI Twins. We will show you the current price and ask for your explicit confirmation before billing begins.";

/** Presentation only: no price lookup, entitlement, consent event or payment action. */
export function TwinSubscriptionDisclosure() {
  return (
    <p
      role="note"
      aria-label="AI Twin subscription terms"
      lang="en"
      className="text-waia-fg-muted shrink-0 text-base leading-relaxed"
    >
      {TWIN_SUBSCRIPTION_DISCLOSURE}
    </p>
  );
}
