"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { WaiaSurface } from "@/components/waia/waia-surface";

export type AdminOrganization = {
  id: string;
  name: string | null;
  kind: string;
};

type AdminOrgSelectorProps = {
  organizations: AdminOrganization[];
  value: string;
  onChange: (organizationId: string) => void;
};

export function AdminOrgSelector({ organizations, value, onChange }: AdminOrgSelectorProps) {
  return (
    <WaiaSurface variant="raised" className="p-4">
      <label htmlFor="admin-org-select" className="text-sm font-medium">
        Organization
      </label>
      <select
        id="admin-org-select"
        data-testid="admin-org-select"
        className="border-border bg-background mt-2 w-full max-w-md rounded-md border px-3 py-2 text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {organizations.length === 0 ? (
          <option value="">No organizations</option>
        ) : (
          organizations.map((org) => (
            <option key={org.id} value={org.id}>
              {org.name ?? org.id} ({org.kind})
            </option>
          ))
        )}
      </select>
    </WaiaSurface>
  );
}

export function useAdminOrganizations() {
  const [organizations, setOrganizations] = React.useState<AdminOrganization[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/trader/admin/organizations", { cache: "no-store" });
        const body = (await response.json()) as {
          organizations?: AdminOrganization[];
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new Error(body.error?.message ?? "Failed to load organizations.");
        }
        if (!cancelled) {
          setOrganizations(body.organizations ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load organizations.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { organizations, loading, error };
}

export async function adminFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const response = await fetch(path, { ...init, cache: "no-store" });
  const body = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) {
    return { ok: false, message: body.error?.message ?? "Request failed." };
  }
  return { ok: true, data: body };
}

export function AdminLoadingState({ label = "Loading…" }: { label?: string }) {
  return <p className="text-muted-foreground text-sm">{label}</p>;
}

export function AdminErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <WaiaSurface variant="raised" className="space-y-3 p-4">
      <p className="text-destructive text-sm">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </WaiaSurface>
  );
}
