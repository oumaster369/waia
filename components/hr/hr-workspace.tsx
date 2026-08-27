"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";

type EventRow = {
  id: string;
  eventType: string;
  comment: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
};
type Application = {
  id: string;
  identityName: string;
  contactEmail: string;
  publicProfileUrl: string | null;
  targetType: string;
  targetReference: string | null;
  competencies: string;
  experience: string;
  collaborationTerms: string;
  context: string;
  status: string;
  assignedToUserId: string | null;
  createdAt: string;
  events: EventRow[];
};
type HrData = {
  applications: Application[];
  assignees: Array<{ id: string; email: string; displayName: string | null }>;
  statuses: string[];
};

const label = (value: string) => value.toLowerCase().replaceAll("_", " ");

function allowedNextStatuses(current: string, statuses: string[]) {
  if (current === "TERMINATION") return [];
  const next = statuses[statuses.indexOf(current) + 1];
  return [...new Set([next, "TERMINATION"].filter(Boolean))];
}

async function fetchHrData() {
  const response = await fetch("/api/admin/hr/applications", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load HR applications.");
  return (await response.json()) as HrData;
}

export function HrWorkspace() {
  const [data, setData] = useState<HrData | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("ALL");
  useEffect(() => {
    let active = true;
    fetchHrData()
      .then((next) => {
        if (active) setData(next);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Could not load HR.");
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = useMemo(
    () => data?.applications.filter((row) => filter === "ALL" || row.status === filter) ?? [],
    [data, filter],
  );
  async function mutate(id: string, body: Record<string, unknown>) {
    setError("");
    const response = await fetch(`/api/admin/hr/applications/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!response.ok) throw new Error(result.error?.message ?? "HR update failed.");
    setData(await fetchHrData());
  }

  if (!data && !error) return <p className="text-muted-foreground text-sm">Loading HR…</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-medium">Team applications</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Append-only intake and accountable status history.
          </p>
        </div>
        <select
          className="bg-background rounded-md border px-3 py-2 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="ALL">All statuses</option>
          {data?.statuses.map((status) => (
            <option key={status} value={status}>
              {label(status)}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
      {rows.length === 0 ? (
        <WaiaSurface className="p-5 text-sm">No applications in this view.</WaiaSurface>
      ) : null}
      {rows.map((application) => (
        <WaiaSurface key={application.id} variant="raised" className="space-y-5 p-5">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h3 className="text-lg font-medium">{application.identityName}</h3>
              <a
                className="text-muted-foreground text-sm underline"
                href={`mailto:${application.contactEmail}`}
              >
                {application.contactEmail}
              </a>
              {application.publicProfileUrl ? (
                <a
                  className="text-muted-foreground ml-3 text-sm underline"
                  href={application.publicProfileUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Public profile
                </a>
              ) : null}
            </div>
            <span className="rounded-full border px-3 py-1 text-xs uppercase">
              {label(application.status)}
            </span>
          </div>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Target</dt>
              <dd>
                {label(application.targetType)}
                {application.targetReference ? ` · ${application.targetReference}` : ""}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Terms</dt>
              <dd className="whitespace-pre-wrap">{application.collaborationTerms}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Competencies</dt>
              <dd className="whitespace-pre-wrap">{application.competencies}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Experience</dt>
              <dd className="whitespace-pre-wrap">{application.experience}</dd>
            </div>
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Responsible
              <select
                className="bg-background mt-1 w-full rounded-md border px-3 py-2"
                value={application.assignedToUserId ?? ""}
                onChange={(event) =>
                  mutate(application.id, {
                    command: "assign",
                    assigneeUserId: event.target.value,
                  }).catch((caught) => setError(caught.message))
                }
              >
                <option value="" disabled>
                  Choose a WAIA employee
                </option>
                {data?.assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName ?? person.email}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Move to status
              <select
                className="bg-background mt-1 w-full rounded-md border px-3 py-2"
                value=""
                onChange={(event) =>
                  mutate(application.id, {
                    command: "transition",
                    toStatus: event.target.value,
                  }).catch((caught) => setError(caught.message))
                }
              >
                <option value="" disabled>
                  Choose next status
                </option>
                {allowedNextStatuses(application.status, data?.statuses ?? []).map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <form
            className="flex gap-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const comment = String(form.get("comment") ?? "");
              mutate(application.id, { command: "comment", comment })
                .then(() => event.currentTarget.reset())
                .catch((caught) => setError(caught.message));
            }}
          >
            <input
              className="bg-background min-w-0 flex-1 rounded-md border px-3 py-2 text-sm"
              name="comment"
              placeholder="Add an internal comment"
              required
            />
            <Button type="submit" variant="outline">
              Add
            </Button>
          </form>
          <ol className="border-border space-y-2 border-l pl-4 text-sm">
            {application.events.map((event) => (
              <li key={event.id}>
                <span className="text-muted-foreground text-xs">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
                <p>
                  {event.comment ??
                    `${label(event.eventType)}${event.toStatus ? ` → ${label(event.toStatus)}` : ""}`}
                </p>
              </li>
            ))}
          </ol>
        </WaiaSurface>
      ))}
    </div>
  );
}
