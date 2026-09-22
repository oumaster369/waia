"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WaiaSurface } from "@/components/waia/waia-surface";

type SavedProfile = {
  displayName: string;
  locale: string;
};

type ProfileResponse = {
  ok?: boolean;
  profile?: SavedProfile;
  error?: { message?: string };
};

export function TraderProfileSettings() {
  const [displayName, setDisplayName] = React.useState("");
  const [locale, setLocale] = React.useState("");
  const [saved, setSaved] = React.useState<SavedProfile | null>(null);
  const [status, setStatus] = React.useState<"loading" | "ready" | "unavailable">("loading");
  const [message, setMessage] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/profile", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok) {
          setStatus("unavailable");
          return;
        }
        const body = (await response.json()) as ProfileResponse;
        if (!body.ok || !body.profile) {
          setStatus("unavailable");
          return;
        }
        setDisplayName(body.profile.displayName);
        setLocale(body.profile.locale);
        setSaved(body.profile);
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      }
    })();
    return () => controller.abort();
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!saved || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, locale }),
      });
      const body = (await response.json().catch(() => null)) as ProfileResponse | null;
      if (!response.ok || !body?.ok || !body.profile) {
        setDisplayName(saved.displayName);
        setLocale(saved.locale);
        setMessage(body?.error?.message ?? "Profile could not be saved.");
        return;
      }
      setDisplayName(body.profile.displayName);
      setLocale(body.profile.locale);
      setSaved(body.profile);
      setMessage("Saved.");
    } catch {
      setDisplayName(saved.displayName);
      setLocale(saved.locale);
      setMessage("Profile could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <WaiaSurface
      variant="raised"
      className="mb-6 space-y-3 p-5"
      data-testid="trader-profile-settings"
    >
      <div>
        <h2 className="text-lg font-medium">Profile</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Display name and locale only. This does not change capital, risk, or execution authority.
        </p>
      </div>
      {status === "loading" ? (
        <p className="text-muted-foreground text-sm">Loading profile…</p>
      ) : null}
      {status === "unavailable" ? (
        <p className="text-muted-foreground text-sm" role="status">
          Profile settings are unavailable.
        </p>
      ) : null}
      {status === "ready" && saved ? (
        <form className="space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="text-sm font-medium" htmlFor="trader-display-name">
              Display name
            </label>
            <Input
              id="trader-display-name"
              className="mt-1"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="nickname"
              maxLength={80}
            />
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="trader-locale">
              Locale
            </label>
            <Input
              id="trader-locale"
              className="mt-1"
              value={locale}
              onChange={(event) => setLocale(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
          {message ? (
            <p className="text-sm" role="status">
              {message}
            </p>
          ) : null}
        </form>
      ) : null}
    </WaiaSurface>
  );
}
