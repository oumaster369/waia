"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { publicPanelClass } from "@/components/public/public-page-shell";

export function TeamApplicationForm({ initialName }: { initialName?: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("sending");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/public/team-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identityName: form.get("identityName"),
        contactEmail: form.get("contactEmail"),
        publicProfileUrl: form.get("publicProfileUrl"),
        targetType: form.get("targetType"),
        targetReference: form.get("targetReference"),
        competencies: form.get("competencies"),
        experience: form.get("experience"),
        collaborationTerms: form.get("collaborationTerms"),
        context: form.get("context"),
        consent: form.get("consent") === "on",
        website: form.get("website"),
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    if (!response.ok) {
      setState("error");
      setMessage(body.error?.message ?? "The application could not be sent.");
      return;
    }
    event.currentTarget.reset();
    setState("sent");
    setMessage("Thank you. Your application is now in the WAIA HR funnel.");
  }

  const inputClass =
    "border-waia-divider bg-waia-canvas text-waia-fg focus:border-waia-accent-cool rounded-md border px-3 py-2 text-sm outline-none";
  return (
    <section className={`${publicPanelClass} space-y-5`} aria-labelledby="join-waia-heading">
      <div>
        <h2 id="join-waia-heading" className="font-waia-serif text-waia-fg text-2xl">
          Join the work
        </h2>
        <p className="text-waia-fg-muted mt-2 max-w-3xl leading-relaxed">
          Offer your help with a task, milestone or project. Tell us what you can do and what form
          of collaboration would work for you.
        </p>
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="flex flex-col gap-1.5 text-sm">
          Your name
          <input className={inputClass} name="identityName" defaultValue={initialName} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Contact email
          <input className={inputClass} name="contactEmail" type="email" required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          Public profile, website or social link
          <input className={inputClass} name="publicProfileUrl" type="url" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          I want to help with
          <select className={inputClass} name="targetType" defaultValue="TASK">
            <option value="TASK">A task</option>
            <option value="MILESTONE">A milestone</option>
            <option value="PROJECT">A project</option>
            <option value="GENERAL">WAIA in general</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Task, milestone or project
          <input
            className={inputClass}
            name="targetReference"
            placeholder="DEE-747 or project name"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          Competencies
          <textarea className={inputClass} name="competencies" rows={3} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          Relevant experience
          <textarea className={inputClass} name="experience" rows={4} required />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          Collaboration terms
          <textarea
            className={inputClass}
            name="collaborationTerms"
            rows={2}
            placeholder="Fixed fee, equity, another arrangement, or open to discussion"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          Anything else we should know
          <textarea className={inputClass} name="context" rows={3} />
        </label>
        <input name="website" className="hidden" tabIndex={-1} autoComplete="off" />
        <label className="text-waia-fg-muted flex items-start gap-2 text-sm sm:col-span-2">
          <input name="consent" type="checkbox" required className="mt-1" />I agree that WAIA may
          store this application and contact me about collaboration.
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button disabled={state === "sending"} type="submit">
            {state === "sending" ? "Sending…" : "Send application"}
          </Button>
          {message ? (
            <p
              className={
                state === "error" ? "text-destructive text-sm" : "text-waia-fg-muted text-sm"
              }
            >
              {message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
