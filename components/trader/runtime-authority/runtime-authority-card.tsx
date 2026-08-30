"use client";
import * as React from "react";

type Model = { availability: "AVAILABLE" | "UNAVAILABLE"; posture: string | null; reasonCodes: string[];
  runtimeInstanceId: string; adjudicatedAtUtc: string | null };

export function RuntimeAuthorityCard({ endpoint }: { endpoint: string }) {
  const [model, setModel] = React.useState<Model | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { let active = true; void fetch(endpoint, { cache: "no-store" }).then(async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? "Runtime Authority is unavailable.");
    if (active) setModel(body.runtimeAuthority);
  }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Unavailable"); });
  return () => { active = false; }; }, [endpoint]);
  if (error) return <p role="alert">Runtime Authority unavailable: {error}</p>;
  if (!model) return <p>Loading Runtime Authority…</p>;
  return <section className="space-y-3 rounded-md border p-4" aria-labelledby="runtime-authority-title">
    <h2 id="runtime-authority-title" className="text-lg font-medium">Runtime Authority</h2>
    <p><strong>{model.availability === "AVAILABLE" ? model.posture : "UNAVAILABLE"}</strong></p>
    <p className="text-sm">This is read-only recovery and lease posture. It does not enable live trading or capital.</p>
    <ul className="list-disc pl-5 text-sm">{model.reasonCodes.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    {model.adjudicatedAtUtc ? <p className="text-xs">Adjudicated: {model.adjudicatedAtUtc}</p> : null}
  </section>;
}
