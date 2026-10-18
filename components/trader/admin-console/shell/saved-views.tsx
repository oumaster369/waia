"use client";
import * as React from "react";
import Link from "next/link";
import { useAdminReadContext } from "@/components/trader/admin-console/data/read-context";
import { sectionForPath } from "@/components/trader/admin-console/navigation/sections";
import { controlClass } from "@/components/trader/admin-console/primitives/console-ui";
import { notifyAdminAccessRevoked } from "@/components/trader/admin-console/data/access-events";
import { BUILTIN_VIEWS, savedViewHref } from "@/lib/trader/admin-console/saved-view-state";
import { DataState } from "@/components/trader/admin-console/primitives/data-state";
type View = { id: string; section: string; name: string; state: unknown };
type Collection = { revision: string; views: View[] };
export function SavedViews({ actions }: { actions?: React.ReactNode }) {
  const context = useAdminReadContext();
  const section = sectionForPath(context.pathname);
  const [open, setOpen] = React.useState(false);
  const [collection, setCollection] = React.useState<Collection | null>(null);
  const [reason, setReason] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    controller.current = abort;
    void fetch("/api/trader/admin/console/saved-views", { signal: abort.signal, cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) {
          notifyAdminAccessRevoked();
          return;
        }
        const data = await response.json();
        if (abort.signal.aborted) return;
        if (response.ok && typeof data.revision === "string" && Array.isArray(data.views))
          setCollection(data);
        else setReason(data.reason ?? data.data?.reasons?.[0] ?? data.error?.code ?? "READ_FAILED");
      })
      .catch(() => {
        if (!abort.signal.aborted) setReason("NETWORK_ERROR");
      });
    return () => {
      abort.abort();
      controller.current = null;
    };
  }, [open]);
  async function mutate(id?: string) {
    if (!collection || pending) return;
    const signal = controller.current?.signal;
    setPending(true);
    setMessage(null);
    const state = { query: new URLSearchParams(context.query).toString() };
    const params = new URLSearchParams(state.query);
    for (const key of ["tab", "status", "q", "sort"])
      if (context.params.has(key)) params.set(key, context.params.get(key)!);
    state.query = params.toString();
    try {
      const response = await fetch("/api/trader/admin/console/saved-views", {
        method: id ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify(
          id
            ? { id, expectedRevision: collection.revision }
            : {
                section: section.id,
                name: name.trim(),
                state,
                expectedRevision: collection.revision,
              },
        ),
      });
      if (response.status === 401 || response.status === 403) {
        notifyAdminAccessRevoked();
        return;
      }
      const data = await response.json();
      if (signal?.aborted) return;
      const freshResponse = await fetch("/api/trader/admin/console/saved-views", {
        cache: "no-store",
        signal,
      });
      const fresh = await freshResponse.json();
      if (signal?.aborted) return;
      if (freshResponse.ok && typeof fresh.revision === "string" && Array.isArray(fresh.views))
        setCollection(fresh);
      else {
        setCollection(null);
        throw new Error("READ_BACK_FAILED");
      }
      setMessage(
        response.status === 409
          ? "The list changed. Fresh views are shown; review them before retrying."
          : response.ok
            ? id
              ? "View deleted."
              : "View saved."
            : `Could not save: ${data.error?.code ?? "READ_FAILED"}`,
      );
      if (response.ok) setName("");
    } catch {
      if (!signal?.aborted)
        setMessage("Could not confirm the change. Close and reopen views.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="border-waia-divider mt-3 border-t pt-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className={controlClass}
          type="button"
          aria-expanded={open}
          onClick={() => {
            setCollection(null);
            setReason(null);
            setMessage(null);
            setOpen((v) => !v);
          }}
        >
          Views
        </button>
        {actions}
        {context.params.get("status") ? (
          <span className="border-waia-rim rounded border px-3 py-2">
            Filter:{" "}
            {(
              {
                ISSUED: "unpaid",
                REJECTED: "rejected",
                inactive: "campaigns: drafts, paused and archived",
              } as Record<string, string>
            )[context.params.get("status")!] ?? context.params.get("status")}{" "}
            <button className="ml-2 underline" onClick={() => context.update({ status: null })}>
              Reset
            </button>
          </span>
        ) : null}
      </div>
      {open ? (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-waia-fg-muted mb-2">
              Built-in views · retain the current scope
            </p>
            <div className="flex flex-wrap gap-2">
              {BUILTIN_VIEWS.map((view) => (
                <Link
                  className={controlClass}
                  href={context.href(view.path)}
                  key={view.id}
                  onClick={() => setOpen(false)}
                >
                  {view.name}
                </Link>
              ))}
            </div>
          </div>
          <div>
            <p className="text-waia-fg-muted mb-2">
              My views · restore the saved scope and period
            </p>
            {reason ? (
              <DataState state="unavailable" reason={reason} />
            ) : collection ? (
              <ul className="space-y-2">
                {collection.views.map((view) => {
                  const href = savedViewHref(view.section, view.state);
                  return (
                    <li key={view.id} className="flex items-center gap-3">
                      {href ? (
                        <Link className="underline" href={href} onClick={() => setOpen(false)}>
                          {view.name}
                        </Link>
                      ) : (
                        <span>{view.name} · unsupported format</span>
                      )}
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void mutate(view.id)}
                        className="text-waia-fg-muted ml-auto underline"
                        aria-label={`Delete view ${view.name}`}
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
                {!collection.views.length ? (
                  <li className="text-waia-fg-muted">No saved views yet</li>
                ) : null}
              </ul>
            ) : (
              <p>Loading views…</p>
            )}
            <form
              className="mt-3 flex flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void mutate();
              }}
            >
              <label className="sr-only" htmlFor="admin-view-name">
                View name
              </label>
              <input
                id="admin-view-name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="View name"
                className={controlClass}
              />
              <button className={controlClass} disabled={!collection || pending || !name.trim()}>
                {pending ? "Saving…" : "Save current view"}
              </button>
            </form>
            {message ? (
              <p role="status" className="mt-2">
                {message}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
