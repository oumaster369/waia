"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

type CreatedIntent = {
  id: string;
  address: string;
  exactAmountUsdt: string;
  expiresAt: string;
  status: "PENDING";
};

const inputClass =
  "border-waia-divider bg-waia-field-deep text-waia-fg focus:border-waia-accent-warm w-full rounded-lg border px-3 py-2 text-sm outline-none";

async function copy(value: string) {
  await navigator.clipboard.writeText(value);
}

export function ContributionIntentForm({ displayName }: { displayName: string }) {
  const [intent, setIntent] = useState<CreatedIntent | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/public/contribution-intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: data.get("amount"),
          publicSiteUrl: data.get("publicSiteUrl"),
          twinProfileUrl: data.get("twinProfileUrl"),
          consentPublicIdentity: data.get("consentPublicIdentity") === "on",
        }),
      });
      const body = (await response.json()) as {
        intent?: CreatedIntent;
        error?: { message?: string };
      };
      if (!response.ok || !body.intent) {
        throw new Error(body.error?.message ?? "Could not prepare payment instructions.");
      }
      setIntent(body.intent);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not prepare payment instructions.",
      );
    } finally {
      setPending(false);
    }
  }

  if (intent) {
    return (
      <div data-testid="contribution-intent-instructions" className="flex flex-col gap-5">
        <div>
          <h3 className="font-waia-serif text-waia-fg text-xl">Send this exact amount</h3>
          <p className="text-waia-fg-muted mt-2 text-sm leading-relaxed">
            The small decimal suffix identifies your payment. Do not round it. Detection creates a
            Needs review Treasury entry; your public patron record appears only after Human
            verification.
          </p>
        </div>
        <dl className="grid gap-4">
          <div>
            <dt className="text-waia-fg-subtle text-xs tracking-wide uppercase">Address</dt>
            <dd className="text-waia-fg mt-1 font-mono text-sm break-all">{intent.address}</dd>
            <Button className="mt-2" variant="outline" onClick={() => copy(intent.address)}>
              Copy address
            </Button>
          </div>
          <div>
            <dt className="text-waia-fg-subtle text-xs tracking-wide uppercase">Exact amount</dt>
            <dd className="text-waia-fg mt-1 font-mono text-2xl tabular-nums">
              {intent.exactAmountUsdt} USDT
            </dd>
            <Button className="mt-2" variant="outline" onClick={() => copy(intent.exactAmountUsdt)}>
              Copy amount
            </Button>
          </div>
        </dl>
        <p className="text-waia-fg-subtle text-xs">
          Instruction expires {new Date(intent.expiresAt).toLocaleString("en-US")}.
        </p>
      </div>
    );
  }

  return (
    <form data-testid="contribution-intent-form" className="flex flex-col gap-4" onSubmit={submit}>
      <label className="text-waia-fg-muted text-sm">
        Name from your WAIA profile
        <input className={`${inputClass} mt-1 opacity-80`} value={displayName} readOnly />
      </label>
      <label className="text-waia-fg-muted text-sm">
        Contribution amount · USDT
        <input
          className={`${inputClass} mt-1 font-mono`}
          name="amount"
          inputMode="decimal"
          min="1"
          step="0.000001"
          placeholder="100"
          required
        />
      </label>
      <label className="text-waia-fg-muted text-sm">
        Website or social profile · optional
        <input className={`${inputClass} mt-1`} name="publicSiteUrl" type="url" />
      </label>
      <label className="text-waia-fg-muted text-sm">
        WAIA AI-Twin profile · reserved / optional
        <input className={`${inputClass} mt-1`} name="twinProfileUrl" type="url" />
      </label>
      <label className="text-waia-fg-muted flex items-start gap-3 text-sm leading-relaxed">
        <input className="mt-1" name="consentPublicIdentity" type="checkbox" required />
        <span>
          After the payment is verified, show my name, links, confirmed amount and changing share in
          the public Patrons record.
        </span>
      </label>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Preparing…" : "Prepare exact payment"}
      </Button>
    </form>
  );
}
